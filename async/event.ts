import { Deferred, deferred } from "./deferred.ts";

export class Event {
  #waiter: Deferred<unknown> | null;
  constructor() {
    this.#waiter = deferred();
  }
  async wait() {
    if (this.#waiter) {
      await this.#waiter;
    }
    return true;
  }
  set() {
    if (this.#waiter) {
      this.#waiter.resolve();
      this.#waiter = null;
    }
  }
  clear() {
    if (!this.#waiter) {
      this.#waiter = deferred();
    }
  }
  is_set() {
    return !this.#waiter;
  }
}
