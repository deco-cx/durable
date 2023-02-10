import { Event, Queue } from "https://deno.land/x/async@v1.2.0/mod.ts";
import { DEBUG_ENABLED } from "../mod.ts";

function isWorkItem<T, TResult>(
  v: T | WorkItem<T, TResult>,
): v is WorkItem<T, TResult> {
  return (v as WorkItem<T, TResult>).item !== "undefined";
}
const noop = async () => {};

const consumerFor = async <T, TResult>(
  workerNum: number,
  q: Queue<WorkItem<T, TResult>>,
  closed: Event,
  handler: (s: T) => Promise<TResult>,
) => {
  while (!closed.is_set()) {
    const recv = await Promise.race([q.get(), closed.wait()]);
    if (recv === true) {
      break;
    }
    if (DEBUG_ENABLED) {
      console.log(`worker[${Deno.hostname()}_${workerNum}]: ${recv.item}`);
    }
    try {
      await handler(recv.item).then(recv.onSuccess).catch(recv.onError);
    } catch (e) {
      console.error("WORKER ERROR", e);
    }
  }
};

const producerFor = async <T, TResult>(
  q: Queue<WorkItem<T, TResult>>,
  closed: Event,
  generator: AsyncGenerator<T | WorkItem<T, TResult>, unknown, unknown>,
) => {
  let next = await generator.next();
  while (!next.done) {
    const value = next.value;
    await q.put(
      isWorkItem(value)
        ? value
        : { item: value, onSuccess: noop, onError: noop },
    );
    next = await generator.next();
  }
  closed.set();
};

export interface WorkItem<T, TResult = unknown> {
  item: T;
  onSuccess: (r: TResult) => Promise<void>;
  onError: (err: unknown) => Promise<void>;
}
/**
 * Start workers based on the specified count (or defaults to 1) in a producer-consumer fashion.
 * The workers are responsible for producing and consuming the data based on the generator function.
 * At least two async routines are started when this function gets invoked.
 * `count` routines for consuming the messages and one routine for producing messages.
 * the cancellation will be called as soon as the generator function returns.
 * it returns the
 */
export const startWorkers = <T, TResult>(
  handler: (s: T) => Promise<TResult>,
  generator: AsyncGenerator<T | WorkItem<T, TResult>, unknown, TResult>,
  count: number,
  queue?: Queue<WorkItem<T, TResult>>,
) => {
  const q = queue ?? new Queue<WorkItem<T, TResult>>(count);
  const closed = new Event();
  let n = 0;
  const workers = new Array<() => Promise<void>>(count)
    .fill(() => consumerFor(n++, q, closed, handler))
    .map((f) => f());
  const producer = producerFor(q, closed, generator);
  return Promise.all([...workers, producer]);
};
