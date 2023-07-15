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

const withOrigin = (url: string): Request => {
  return new Request(new URL(url, "http://localhost"));
};
const parseOrThrow = <T>() => async (resp: Response) => {
  if (resp.ok) {
    return (await resp.json()) as T;
  }
  throw new Error(`http error ${resp.status} ${await resp.text()}`);
};
const eventsFor = (
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
        ),
      ).then(parseOrThrow<HistoryEvent[]>());
    },
    del: async () => {},
    add: async (...events: HistoryEvent[]) => {
      if (route === "/pending") {
        await durable.fetch(
          withOrigin(
            "/pending",
          ),
          { body: JSON.stringify({ events }), method: "POST" },
        ).then(parseOrThrow<HistoryEvent[]>());
      }
    },
  };
};

const executionFor = (
  durable: DurableObjectStub,
): Execution => {
  const useMethod = (method: string) => (workflow: WorkflowExecution) => {
    return durable.fetch(withOrigin("/"), {
      method,
      body: JSON.stringify(workflow),
    }).then(parseOrThrow<void>());
  };
  return {
    get: () => {
      return durable.fetch(withOrigin("/"), { method: "GET" }).then(
        parseOrThrow<WorkflowExecution>(),
      );
    },
    pending: eventsFor("/pending", durable),
    history: eventsFor("/history", durable),
    update: useMethod("PUT"),
    create: useMethod("POST"),
    withinTransaction: async <T>(f: (db: Execution) => PromiseOrValue<T>) => {
      return await f(executionFor(durable));
    },
  };
};
export const dbForEnv = (env: Env): DB => {
  return {
    execution: (executionId: string) => {
      const workflow = env.WORKFLOWS.get(env.WORKFLOWS.idFromName(executionId));
      return executionFor(workflow);
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
