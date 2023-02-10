import { pLimit } from "https://deno.land/x/p_limit@v1.0.0/mod.ts";
import { Arg } from "./types.ts";
import { Lock } from "https://deno.land/x/async@v1.2.0/mod.ts";

/**
 * identity returns the same value as it receives.
 */
export const identity = <T>(val: T): T => {
  return val;
};

/**
 * withConcurrency returns a wrapped function using the specified concurrency as a limiter.
 */
export const withConcurrency = <TArgs extends Arg = Arg, TResult = unknown>(
  concurrency: number,
  f: (...args: [...TArgs]) => TResult,
): (...args: [...TArgs]) => Promise<TResult> => {
  const limiter = pLimit(concurrency);
  return (...args) => {
    return limiter(() => f(...args));
  };
};

/**
 * safeApply applies the given function to the parameter in case of the parameter is not undefined.
 */
export const tryApply =
  <T, U>(f: (v: T) => U) => (v: T | undefined): U | undefined => {
    return v !== undefined ? f(v) : undefined;
  };

/**
 * parses the given integer if not undefined.
 */
export const tryParseInt = tryApply(parseInt);
export const tryParseBool = tryApply((v) => v === "true");

export const apply = <T, TResult>(param: T) => (f: (p: T) => TResult) => {
  return f(param);
};

interface SingleFlight<T> {
  do: (key: string, f: () => Promise<T>) => Promise<T>;
}

export const singleFlight = <T>(): SingleFlight<T> => {
  const mu = new Lock();
  const active: Record<string, Promise<T>> = {};
  return {
    do: async (key: string, f: () => Promise<T>) => {
      let promise = active[key];
      if (promise !== undefined) {
        return promise;
      }
      await mu.acquire();
      promise = active[key];
      if (promise !== undefined) {
        mu.release();
        return promise;
      }
      promise = f();
      active[key] = promise.finally(async () => {
        await mu.acquire();
        delete active[key];
        mu.release();
      });
      mu.release();
      return promise;
    },
  };
};

export const setIntervalFlight = (
  f: () => Promise<void>,
  interval: number,
): number => {
  const sf = singleFlight();
  return setInterval(() => sf.do("single", f), interval);
};
