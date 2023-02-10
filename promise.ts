export type PromiseOrValue<T> = T | Promise<T>;

/**
 * Returns if the @param v is awaitable or not.
 * @param valueOrPromise the promise or value
 * @returns a typeguard for promise or value
 */
export const isAwaitable = <T>(
  valueOrPromise: PromiseOrValue<T>
): valueOrPromise is Promise<T> => {
  return typeof (valueOrPromise as Promise<T>).then === "function";
};
