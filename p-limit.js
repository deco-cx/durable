// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually

class Queue {
    #head;
    #tail;
    #size = 0;
    enqueue(...values) {
        for (const value of values){
            const node = {
                value
            };
            if (this.#head && this.#tail) {
                this.#tail.next = node;
                this.#tail = node;
            } else {
                this.#head = node;
                this.#tail = node;
            }
            this.#size += 1;
        }
    }
    dequeue() {
        const current = this.#head;
        if (!current) {
            return;
        }
        this.#head = current.next;
        this.#size -= 1;
        return current.value;
    }
    clear() {
        this.#head = undefined;
        this.#tail = undefined;
        this.#size = 0;
    }
    get size() {
        return this.#size;
    }
    *[Symbol.iterator]() {
        let current = this.#head;
        while(current){
            yield current.value;
            current = current.next;
        }
    }
}
const pLimit = (concurrency)=>{
    const validConcurrency = (Number.isInteger(concurrency) || concurrency === Infinity) && concurrency > 0;
    if (!validConcurrency) {
        throw new TypeError("Expected `concurrency` to be a number from 1 and up");
    }
    const queue = new Queue();
    let activeCount = 0;
    const generator = (runner, ...args)=>{
        const next = ()=>{
            activeCount -= 1;
            queue.dequeue()?.();
        };
        return new Promise((resolve, reject)=>{
            const run = async ()=>{
                activeCount += 1;
                try {
                    const result = await Promise.resolve(runner(...args));
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
                next();
            };
            queue.enqueue(run);
            queueMicrotask(()=>{
                if (activeCount < concurrency) {
                    queue.dequeue()?.();
                }
            });
        });
    };
    Object.defineProperties(generator, {
        activeCount: {
            get: ()=>activeCount
        },
        pendingCount: {
            get: ()=>queue.size
        },
        clearQueue: {
            value: ()=>{
                queue.clear();
            }
        }
    });
    return generator;
};
export { pLimit as pLimit };

