import { PromiseOrValue } from "../../promise.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import { Env } from "../../src/worker.ts";
import {
  DB,
  Events,
  Execution,
  PaginationParams,
  WorkflowExecution,
} from "../backend.ts";

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
  origin: string,
  route: "/history" | "/pending",
  durable: DurableObjectStub,
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
        await durable.fetch(
          withOrigin(
            "/pending",
            origin,
          ),
          { body: JSON.stringify({ events }), method: "POST" },
        ).then(parseOrThrow<HistoryEvent[]>());
      }
    },
  };
};

const executionFor = (
  origin: string,
  durable: DurableObjectStub,
): Execution => {
  const useMethod = (method: string) => (workflow: WorkflowExecution) => {
    return durable.fetch(withOrigin("/", origin), {
      method,
      body: JSON.stringify(workflow),
    }).then(parseOrThrow<void>());
  };
  return {
    get: () => {
      return durable.fetch(withOrigin("/", origin), { method: "GET" }).then(
        parseOrThrow<WorkflowExecution>(),
      );
    },
    pending: eventsFor(origin, "/pending", durable),
    history: eventsFor(origin, "/history", durable),
    update: useMethod("PUT"),
    create: useMethod("POST"),
    withinTransaction: async <T>(f: (db: Execution) => PromiseOrValue<T>) => {
      return await f(executionFor(origin, durable));
    },
  };
};
export const dbForEnv = (env: Env, origin: string): DB => {
  return {
    execution: (executionId: string) => {
      const workflow = env.WORKFLOWS.get(env.WORKFLOWS.idFromName(executionId));
      return executionFor(origin, workflow);
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
