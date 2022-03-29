import * as nodeRedis from "redis";
import * as ioRedis from "ioredis";
type Callback<D = undefined, E = Error> = (error?: E, data?: D) => void;
/** User's base session */
interface IBaseSession {
    cookie?: {
        expires?: Date;
    };
}
/** Plugin base session store interface */
interface IBaseSessionStore<Session extends IBaseSession> {
    get(sid: string, callback: Callback<Session | null, Error>): void;
    set(sid: string, session: Session, callback?: Callback): void;
    destroy(sid: string, callback?: Callback): void;
    all?(callback: Callback<{
        [sid: string]: Session;
    } | Session[] | null>): void;
    length?(callback: Callback<number>): void;
    clear?(callback?: Callback): void;
    touch?(sid: string, session: Session, callback?: Callback): void;
}
/** Plugin base session class */
type BaseSessionStore<Options extends Record<string, unknown>, Session extends IBaseSession> = abstract new (options?: Options) => IBaseSessionStore<Session>;
type NodeRedis = nodeRedis.RedisClientType;
type IORedis = ioRedis.default | ioRedis.Cluster;
type RedisClient = NodeRedis | IORedis;
/** Session serializer */
interface Serializer<Session extends IBaseSession> {
    stringify(value: Session): string;
    parse(value: string): Session;
}
/** Redis store options */
type RedisStoreOptions<Session extends IBaseSession, BaseStoreOptions> = {
    /** Redis client instance */
    client: RedisClient;
    /** Prefix for redis keys, uses `sess:` by default */
    prefix?: string;
    /** Serializer, uses JSON by default */
    serializer?: Serializer<Session>;
    /** Disable TTL */
    disableTTL?: boolean;
    /** TTL in seconds, default is 24 * 60 * 60 */
    ttl?: number;
    /** Disable touch */
    disableTouch?: boolean;
    /** Parent store instance options */
    options?: BaseStoreOptions;
};
/** Create redis store */
declare function connectRedis<Options extends Record<string, unknown>, Session extends IBaseSession>({ Store }: {
    Store: BaseSessionStore<Options, Session>;
}): {
    new ({ options, client, prefix, serializer, disableTTL, ttl, disableTouch, }: RedisStoreOptions<Session, Options>): {
        prefix: string;
        client: RedisClient;
        serializer: Serializer<Session>;
        disableTTL: boolean;
        ttl: number;
        disableTouch: boolean;
        get(sid: string, callback: Callback<Session | null>): void;
        set(sid: string, session: Session, callback: Callback): void;
        destroy(sid: string, callback: Callback): void;
        touch(sid: string, session: Session, callback: Callback): void;
        clear(callback: Callback): void;
        length(callback: Callback<number>): void;
        ids(callback: Callback<string[]>): void;
        all(callback: Callback<{
            [k: string]: Session;
        }, Error>): void;
        __getTTL(session: Session): number;
        __getAllKeys(): Promise<string[]>;
        __scanKeys(cursor: number, pattern: string, count: number): Promise<string[]>;
    };
};
export { Callback, IBaseSession, IBaseSessionStore, BaseSessionStore, Serializer, connectRedis as default };
