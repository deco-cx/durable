import { Pool, PoolClient } from "pg";
import { PromiseOrValue } from "../../promise.ts";

class PoolInstance {
  private static instance: Pool;

  private constructor() {}

  public static get(): Pool {
    if (!PoolInstance.instance) {
      const DEFAULT_POOL_SIZE = 5;
      const poolSize = DEFAULT_POOL_SIZE;
      PoolInstance.instance = new Pool({ max: poolSize });
    }
    return PoolInstance.instance;
  }
}

/**
 * usePool retrieves a client from client pool and execute the given function using the client as paramater.
 */
export async function usePool<T>(
  f: (client: PoolClient) => PromiseOrValue<T>,
): Promise<T> {
  const client = await (PoolInstance.get().connect());
  try {
    return await f(client);
  } finally {
    client.release();
  }
}
