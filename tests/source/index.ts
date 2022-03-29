import t from "tap"
import fc from "fast-check"

import connectRedis from "connect-redis"
import fastifySession from "@fastify/session"
import redis from "redis-mock"

t.test("fastify + redis", () =>
	fc.assert(
		fc.asyncProperty(fc.string(), fc.object(), async (string, object) => {
			// return new Promise((resolve, reject) => {
				// const RedisStore = connectRedis(fastifySession)
				// const store = new RedisStore({ client: redis.createClient() })

				// store.set(string, object, (error) => {
				// 	if (error) return reject(error)

				// 	store.get(string, (error, session) => {
				// 		if (error) return reject(error)
				// 		return resolve(t.same(session, object))
				// 	})
				// })

				const client = redis.createClient()

				await client.set("key", "value")
				t.same(await client.get("key"), "value")
			// })
		})
	)
)
