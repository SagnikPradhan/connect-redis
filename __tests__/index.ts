import fc from "fast-check"
import { assert } from "chai"

import { connectRedis, __attach } from ".."

import fastifySession from "@fastify/session"
import expressSession from "express-session"
import ioRedis from "ioredis"
import { createClient as createNodeRedisClient } from "redis"
import util from "util"

const MATRIX = [
	["ioRedis + fastify", new ioRedis({ lazyConnect: true }), fastifySession],
	["ioRedis + express", new ioRedis({ lazyConnect: true }), expressSession],
	["redis + fastify", createNodeRedisClient(), fastifySession],
	["redis + express", createNodeRedisClient(), expressSession],
] as const

const sessionArbitary = fc
	.jsonValue()
	.filter((t) => typeof t === "object" && !Array.isArray(t) && t !== null)
	.map((t) => JSON.parse(JSON.stringify(t)))

for (const [name, client, session] of MATRIX) {
	describe(`core methods (${name})`, () => {
		before(() => client.connect())
		after(() => client.disconnect())

		it("should get and set sessions (key, value, prefix)", () =>
			fc.assert(
				fc.asyncProperty(
					fc.uuid(),
					sessionArbitary,
					fc.string(),

					async (key, value, prefix) => {
						const RedisStore = connectRedis(session)
						const store = new RedisStore({
							client,
							prefix,
						})

						// Set and get session
						await util.promisify(store.set.bind(store))(key, value as any)

						assert.deepEqual(
							await util.promisify(store.get.bind(store))(key),
							value as any
						)

						await store.__sendCommand("FLUSHDB")
					}
				)
			))

		it("should set ttl (key, value, disableTTL, ttl)", () =>
			fc.assert(
				fc.asyncProperty(
					fc.uuid(),
					sessionArbitary,
					fc.boolean(),
					fc.integer({ min: 10 }),

					async (key, value, disableTTL, ttl) => {
						const RedisStore = connectRedis(session)
						const store = new RedisStore({
							client,
							disableTTL,
							ttl,
						})

						await util.promisify(store.set.bind(store))(key, value as any)

						// For disabled TTL, TTL is negative
						const foundTTL = await client.ttl(`sess:${key}`)
						assert.strictEqual(foundTTL < 0, disableTTL)

						// TTLs approximately same
						if (!disableTTL) assert.approximately(ttl, foundTTL, 2)

						await store.__sendCommand("FLUSHDB")
					}
				)
			))

		it("should get all sessions, ids. Also clear and length (prefix, sessions(key, value))", () =>
			fc.assert(
				fc.asyncProperty(
					fc.string(),
					fc.dictionary(fc.uuid(), sessionArbitary, { minKeys: 1 }),

					async (prefix, sessions) => {
						const RedisStore = connectRedis(session)
						const store = new RedisStore({ client, prefix })

						for (const key in sessions)
							await util.promisify(store.set.bind(store))(
								key,
								sessions[key] as any
							)

						// Get all values
						assert.deepEqual(
							await util.promisify(store.all.bind(store))(),
							sessions as any
						)

						// Get all ids
						assert.sameMembers(
							(await util.promisify(store.ids.bind(store))()) || [],
							Object.keys(sessions)
						)

						// Number of sessions
						assert.strictEqual(
							await util.promisify(store.length.bind(store))(),
							Object.keys(sessions).length
						)

						// Clear sessions
						await util.promisify(store.clear.bind(store))()

						// After clear number of sessions
						assert.strictEqual(
							await util.promisify(store.length.bind(store))(),
							0
						)

						await store.__sendCommand("FLUSHDB")
					}
				)
			))

		it("should destroy sessions (key)", () =>
			fc.assert(
				fc.asyncProperty(fc.uuid(), async (key) => {
					const RedisStore = connectRedis(session)
					const store = new RedisStore({
						client,
					})

					// Set session
					await util.promisify(store.set.bind(store))(key, {})
					assert.deepEqual(await util.promisify(store.get.bind(store))(key), {})

					// Destroy session
					await util.promisify(store.destroy.bind(store))(key)
					assert.deepEqual(
						await util.promisify(store.get.bind(store))(key),
						null
					)

					await store.__sendCommand("FLUSHDB")
				})
			))

		it("should touch sessions (key, disableTouch, ttl)", () =>
			fc.assert(
				fc.asyncProperty(
					fc.uuid(),
					fc.boolean(),
					fc.integer({ min: 10 }),

					async (key, disableTouch, ttl) => {
						const RedisStore = connectRedis(session)
						const store = new RedisStore({
							client,
							ttl,
							disableTouch,
						})

						await util.promisify(store.set.bind(store))(key, {})
						const firstTTL = await client.ttl(`sess:${key}`)

						// Touch the session
						await util.promisify(store.touch.bind(store))(key, {})
						const secondTTL = await client.ttl(`sess:${key}`)

						if (!disableTouch) assert.approximately(firstTTL, secondTTL, 2)

						await store.__sendCommand("FLUSHDB")
					}
				)
			))
	})
}

describe("utilities", () => {
	it("should attach callbacks", () =>
		fc.assert(
			fc.asyncProperty(
				fc.boolean(),
				fc.anything(),

				(shouldThrow, data) =>
					new Promise((resolve) => {
						__attach((error?: Error, resolved?: unknown) => {
							if (shouldThrow) assert.instanceOf(error, Error)
							else assert.strictEqual(resolved, data)
							resolve()
						})(
							new Promise((resolve, reject) => {
								if (shouldThrow) reject(new Error("Error"))
								else resolve(data)
							})
						)
					})
			)
		))
})
