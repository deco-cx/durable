import {
  Env,
  ExecutionEvent,
  Queue,
} from "../../cloudflare/durable-workers/src/worker.ts";
import { PromiseOrValue } from "../../promise.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import {
  DB,
  Events,
  Execution,
  PaginationParams,
  WorkflowExecution,
} from "../backend.ts";

export type DurableObjectStub = any;
export type DurableObjectTransaction = any;
export type DurableObjectStorage = any;

const withOrigin = (url: string, origin: string): Request => {
  return new Request(new URL(url, origin));
};
const parseOrThrow = <T>() => async (resp: Response) => {
  if (resp.ok) {
    return (await resp.json()) as T;
  }
  throw new Error(`http error ${resp.status} ${await resp.text()}`);
};
const eventsFor = (
  executionId: string,
  origin: string,
  route: "/history" | "/pending",
  durable: DurableObjectStub,
  eventsQ: Queue<ExecutionEvent>,
): Events => {
  return {
    get: (pagination?: PaginationParams) => {
      return durable.fetch(
        withOrigin(
          `${route}?page=${pagination?.page ?? 0}&pageSize=${
            pagination?.pageSize ?? 10
          }`,
          origin,
        ),
      ).then(parseOrThrow<HistoryEvent[]>());
    },
    del: async () => {},
    add: async (...events: HistoryEvent[]) => {
      if (route === "/pending") {
        await eventsQ.send({
          executionId,
          origin,
          payload: {
            events,
          },
        });
      }
    },
  };
};

const executionFor = (
  executionId: string,
  origin: string,
  durable: DurableObjectStub,
  events: Queue<ExecutionEvent>,
): Execution => {
  const upsert = (workflow: WorkflowExecution) => {
    return durable.fetch(withOrigin("/", origin), {
      method: "PUT",
      body: JSON.stringify(workflow),
    }).then(parseOrThrow<void>());
  };
  return {
    get: () => {
      return durable.fetch(withOrigin("/", origin), { method: "GET" }).then(
        parseOrThrow<WorkflowExecution>(),
      );
    },
    pending: eventsFor(executionId, origin, "/pending", durable, events),
    history: eventsFor(executionId, origin, "/history", durable, events),
    update: upsert,
    create: upsert,
    withinTransaction: async <T>(f: (db: Execution) => PromiseOrValue<T>) => {
      return await f(executionFor(executionId, origin, durable, events));
    },
  };
};
export const dbForEnv = (env: Env, origin: string): DB => {
  return {
    execution: (executionId: string) => {
      const workflow = env.WORKFLOWS.get(env.WORKFLOWS.idFromName(executionId));
      return executionFor(executionId, origin, workflow, env.EVENTS);
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
