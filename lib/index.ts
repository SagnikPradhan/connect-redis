import type * as nodeRedis from "redis"
import type * as ioRedis from "ioredis"

export type Callback<D = undefined, E = Error> = (error?: E, data?: D) => void

/** User's base session */
export interface IBaseSession {
	cookie?: { expires?: Date }
}

/** Plugin base session store interface */
export interface IBaseSessionStore<Session extends IBaseSession> {
	get(sid: string, callback: Callback<Session | null, Error>): void
	set(sid: string, session: Session, callback?: Callback): void
	destroy(sid: string, callback?: Callback): void
	all?(callback: Callback<{ [sid: string]: Session } | Session[] | null>): void
	length?(callback: Callback<number>): void
	clear?(callback?: Callback): void
	touch?(sid: string, session: Session, callback?: Callback): void
}

/** Plugin base session class */
export type BaseSessionStore<
	Options extends Record<string, unknown>,
	Session extends IBaseSession
> = abstract new (options?: Options) => IBaseSessionStore<Session>

type NodeRedis = nodeRedis.RedisClientType
type IORedis = ioRedis.default | ioRedis.Cluster
type RedisClient = NodeRedis | IORedis

const isNodeRedis = (client: RedisClient): client is NodeRedis =>
	"SCAN" in client

/** Session serializer */
export interface Serializer<Session extends IBaseSession> {
	stringify(value: Session): string
	parse(value: string): Session
}

/** Redis store options */
type RedisStoreOptions<Session extends IBaseSession, BaseStoreOptions> = {
	/** Redis client instance */
	client: RedisClient
	/** Prefix for redis keys, uses `sess:` by default */
	prefix?: string
	/** Serializer, uses JSON by default */
	serializer?: Serializer<Session>
	/** Disable TTL */
	disableTTL?: boolean
	/** TTL in seconds, default is 24 * 60 * 60 */
	ttl?: number
	/** Disable touch */
	disableTouch?: boolean
	/** Parent store instance options */
	options?: BaseStoreOptions
}

function attach<Value>(callback: Callback<Value>) {
	return (promise: Promise<Value>) => {
		promise
			.then((value) => callback(undefined, value))
			.catch((error) => callback(error))
	}
}

/** Create redis store */
export default function connectRedis<
	Options extends Record<string, unknown>,
	Session extends IBaseSession
>({ Store }: { Store: BaseSessionStore<Options, Session> }) {
	return class RedisStore extends Store {
		prefix: string
		client: RedisClient
		serializer: Serializer<Session>
		disableTTL: boolean
		ttl: number
		disableTouch: boolean

		constructor({
			options,
			client,
			prefix,
			serializer,
			disableTTL,
			ttl,
			disableTouch,
		}: RedisStoreOptions<Session, Options>) {
			super(options)

			this.client = client
			this.prefix = prefix || "sess:"
			this.serializer = serializer || JSON
			this.disableTTL = disableTTL || false
			this.ttl = ttl || 24 * 60 * 60
			this.disableTouch = disableTouch || false
		}

		get(sid: string, callback: Callback<Session | null>) {
			const main = async () => {
				const key = `${this.prefix}${sid}`
				const value = await this.client.get(key)
				if (!value) return null
				return this.serializer.parse(value)
			}

			attach(callback)(main())
		}

		set(sid: string, session: Session, callback: Callback) {
			const main = async () => {
				const key = `${this.prefix}${sid}`
				const value = this.serializer.stringify(session)

				const ttl = this.__getTTL(session)
				if (ttl < 0 && !this.disableTTL) return await this.client.del(key)

				if (this.disableTTL) this.client.set(key, value)
				else if (isNodeRedis(this.client))
					await this.client.set(key, value, { EX: ttl })
				else await this.client.set(key, value, "EX", ttl)
			}

			attach(callback)(main().then(() => undefined))
		}

		destroy(sid: string, callback: Callback) {
			const key = `${this.prefix}${sid}`

			attach(callback)(this.client.del(key).then(() => undefined))
		}

		touch(sid: string, session: Session, callback: Callback) {
			const main = async () => {
				if (this.disableTouch || this.disableTouch) return undefined
				const key = `${this.prefix}${sid}`
				await this.client.expire(key, this.__getTTL(session))
			}

			attach(callback)(main())
		}

		clear(callback: Callback) {
			attach(callback)(
				this.__getAllKeys().then((keys) => void this.client.del(keys))
			)
		}

		length(callback: Callback<number>) {
			attach(callback)(this.__getAllKeys().then((value) => value.length))
		}

		ids(callback: Callback<string[]>) {
			attach(callback)(
				this.__getAllKeys().then((keys) =>
					keys.map((k) => k.slice(this.prefix.length))
				)
			)
		}

		all(callback: Callback<{ [k: string]: Session }>) {
			const main = async () => {
				const keys = await this.__getAllKeys()
				const values = isNodeRedis(this.client)
					? await this.client.mGet(keys)
					: await this.client.mget(keys)

				return Object.fromEntries(
					keys
						.map((key, idx) => {
							const value = values[idx]

							if (value)
								return [
									key.slice(this.prefix.length),
									this.serializer.parse(value),
								] as const
							else return null
						})
						.filter((value): value is [string, Session] => Boolean(value))
				)
			}

			attach(callback)(main())
		}

		__getTTL(session: Session) {
			return session?.cookie?.expires
				? Math.ceil((Number(session.cookie.expires) - Date.now()) / 1000)
				: this.ttl
		}

		async __getAllKeys() {
			const pattern = `${this.prefix}*`
			return this.__scanKeys(0, pattern, 100)
		}

		async __scanKeys(
			cursor: number,
			pattern: string,
			count: number
		): Promise<string[]> {
			const { cursor: nextCursor, keys } = await (isNodeRedis(this.client)
				? this.client.scan(cursor, { COUNT: count, MATCH: pattern })
				: this.client
						.scan(cursor, "MATCH", pattern, "COUNT", count)
						.then(([cursor, keys]) => ({ cursor: Number(cursor), keys })))

			return [
				...keys,
				...(nextCursor !== 0
					? await this.__scanKeys(nextCursor, pattern, count)
					: []),
			]
		}
	}
}
