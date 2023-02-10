import { Pool, PoolClient } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { PromiseOrValue } from "../../promise.ts";
import { tryParseInt } from "../../utils.ts";

const DEFAULT_POOL_SIZE = 5;
const poolSize = tryParseInt(Deno.env.get("PGPOOLSIZE")) ?? DEFAULT_POOL_SIZE;
const pool = new Pool({}, poolSize, true);

/**
 * usePool retrieves a client from client pool and execute the given function using the client as paramater.
 */
export async function usePool<T>(
  f: (client: PoolClient) => PromiseOrValue<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await f(client);
  } finally {
    client.release();
  }
}
