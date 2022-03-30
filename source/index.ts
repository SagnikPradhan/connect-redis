import type * as nodeRedis from "redis"
import type * as ioRedis from "ioredis"

export type Callback<D = undefined, E = Error> = (error?: E, data?: D) => void

/** User's base session */
export interface IBaseSession {
	[index: string]: unknown
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

type NodeRedis = nodeRedis.RedisClientType<any, any>
type IORedis = ioRedis.default | ioRedis.Cluster
export type RedisClient = NodeRedis | IORedis

const isNodeRedis = (client: RedisClient): client is NodeRedis =>
	"SCAN" in client

/** Session serializer */
export interface Serializer<Session extends IBaseSession> {
	stringify(value: Session): string
	parse(value: string): Session
}

/** Redis store options */
export interface RedisStoreOptions<
	Session extends IBaseSession,
	BaseStoreOptions
> {
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

export function __attach<Value>(callback: Callback<Value>) {
	return (promise: Promise<Value>) => {
		promise
			.then((value) => callback(undefined, value))
			.catch((error) => callback(error))
	}
}

const noop = () => {}

export type ConnectRedisOption<
	Options extends Record<string, unknown>,
	Session extends IBaseSession
> = {
	Store: BaseSessionStore<Options, Session>
}

/** Create redis store */
export function connectRedis<
	Options extends Record<string, unknown>,
	Session extends IBaseSession
>({ Store }: ConnectRedisOption<Options, Session>) {
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
			this.prefix = typeof prefix === "string" ? prefix : "sess:"
			this.serializer = serializer || JSON
			this.disableTTL = disableTTL || false
			this.ttl = ttl || 24 * 60 * 60
			this.disableTouch = disableTouch || false
		}

		get(sid: string, callback: Callback<Session | null>) {
			const main = async () => {
				const key = `${this.prefix}${sid}`
				const value = await this.__sendCommand<string | null>("GET", key)
				if (value) return this.serializer.parse(value)
				else return null
			}

			__attach(callback)(main())
		}

		set(sid: string, session: Session, callback: Callback = noop) {
			const main = async () => {
				const key = `${this.prefix}${sid}`
				const value = this.serializer.stringify(session)

				if (this.disableTTL) return this.__sendCommand("SET", key, value)

				// Redis throws an error if negative TTL
				const ttl = this.__getTTL(session)
				if (ttl < 0) return this.__sendCommand("DEL", key)

				return this.__sendCommand("SET", key, value, "EX", ttl.toString())
			}

			__attach(callback)(main().then(() => undefined))
		}

		destroy(sid: string, callback: Callback = noop) {
			const key = `${this.prefix}${sid}`
			__attach(callback)(this.__sendCommand("DEL", key).then(() => undefined))
		}

		touch(sid: string, session: Session, callback: Callback = noop) {
			const main = async () => {
				if (this.disableTTL || this.disableTouch) return undefined
				const key = `${this.prefix}${sid}`

				await this.__sendCommand(
					"EXPIRE",
					key,
					this.__getTTL(session).toString()
				)
			}

			__attach(callback)(main())
		}

		clear(callback: Callback = noop) {
			__attach(callback)(
				this.__getAllKeys().then(
					(keys) => void this.__sendCommand("DEL", ...keys)
				)
			)
		}

		length(callback: Callback<number>) {
			__attach(callback)(this.__getAllKeys().then((value) => value.length))
		}

		ids(callback: Callback<string[]>) {
			__attach(callback)(
				this.__getAllKeys().then((keys) =>
					keys.map((k) => k.slice(this.prefix.length))
				)
			)
		}

		all(callback: Callback<{ [k: string]: Session }>) {
			const main = async () => {
				const keys = await this.__getAllKeys()

				const values = await this.__sendCommand<(string | null)[]>(
					"MGET",
					...keys
				)

				return Object.fromEntries(
					keys.map((key, idx) => {
						const value = values[idx]!

						return [
							key.slice(this.prefix.length),
							this.serializer.parse(value),
						] as const
					})
				)
			}

			__attach(callback)(main())
		}

		__getTTL(session: Session) {
			return session?.cookie?.expires
				? Math.ceil((Number(session.cookie.expires) - Date.now()) / 1000)
				: this.ttl
		}

		__getAllKeys() {
			const escapedPrefix = this.prefix
				.replace(/\\/g, "\\\\")
				.replace(/\*/g, "\\*")
				.replace(/\?/g, "\\?")
				.replace(/\[/g, "\\[")
				.replace(/\]/g, "\\]")
				.replace(/\{/g, "\\{")
				.replace(/\}/g, "\\}")
				.replace(/\)/g, "\\)")
				.replace(/\(/g, "\\(")
				.replace(/\!/g, "\\!")

			const pattern = `${escapedPrefix}*`

			return this.__scanKeys(0, pattern, 100)
		}

		async __scanKeys(
			cursor: number,
			pattern: string,
			count: number
		): Promise<string[]> {
			const [nextCursor, keys] = await this.__sendCommand<[number, string[]]>(
				"SCAN",
				cursor.toString(),
				"MATCH",
				pattern,
				"COUNT",
				count.toString()
			).then(([cursor, keys]) => [Number(cursor), keys.map(String)] as const)

			return [
				...keys,
				...(nextCursor !== 0
					? await this.__scanKeys(nextCursor, pattern, count)
					: []),
			]
		}

		__sendCommand<Data>(...[cmd, ...args]: string[]) {
			return new Promise<Data>((resolve) => {
				if (isNodeRedis(this.client))
					resolve(this.client.sendCommand([cmd, ...args], {}))
				else {
					const ioRedis = require("ioredis") as typeof import("ioredis")
					const redisCommand = new ioRedis.Command(cmd, args)
					resolve(redisCommand.promise)
					this.client.sendCommand(redisCommand)
				}
			})
		}
	}
}
