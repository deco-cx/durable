import { Metadata } from "../../context.ts";
import { PromiseOrValue } from "../../promise.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import { Env } from "../../src/worker.ts";
import { Arg } from "../../types.ts";
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
  { signal }: DBContext,
  route: "/history" | "/pending",
  durable: DurableObjectStub,
): Events => {
  return {
    stream: () => {
      return durable.fetch(
        withOrigin(
          `${route}?stream=true`,
        ),
        { signal },
      );
    },
    get: (pagination?: PaginationParams) => {
      return durable.fetch(
        withOrigin(
          `${route}?page=${pagination?.page ?? 0}&pageSize=${
            pagination?.pageSize ?? 10
          }`,
        ),
        { signal },
      ).then(parseOrThrow<HistoryEvent[]>());
    },
    del: async () => {},
    add: async (...events: HistoryEvent[]) => {
      if (route === "/pending") {
        await durable.fetch(
          withOrigin(
            "/pending",
          ),
          { body: JSON.stringify({ events }), method: "POST", signal },
        ).then(parseOrThrow<HistoryEvent[]>());
      }
    },
  };
};

const executionFor = (
  { signal, ...rest }: DBContext,
  durable: DurableObjectStub,
): Execution => {
  const useMethod = (method: string) => (workflow: WorkflowExecution) => {
    return durable.fetch(withOrigin("/"), {
      signal,
      method,
      body: JSON.stringify(workflow),
    }).then(parseOrThrow<void>());
  };
  return {
    get: <
      TArgs extends Arg = Arg,
      TResult = unknown,
      TMetadata extends Metadata = Metadata,
    >() => {
      return durable.fetch(withOrigin("/"), { method: "GET", signal }).then(
        parseOrThrow<WorkflowExecution<TArgs, TResult, TMetadata>>(),
      );
    },
    pending: eventsFor({ signal, ...rest }, "/pending", durable),
    history: eventsFor({ signal, ...rest }, "/history", durable),
    update: useMethod("PUT"),
    create: useMethod("POST"),
    withinTransaction: async <T>(f: (db: Execution) => PromiseOrValue<T>) => {
      return await f(executionFor({ signal, ...rest }, durable));
    },
  };
};

export interface DBContext {
  env: Env;
  signal?: AbortSignal;
}
export const dbForEnv = (ctx: DBContext): DB => {
  return {
    execution: (executionId: string) => {
      const workflow = ctx.env.WORKFLOWS.get(
        ctx.env.WORKFLOWS.idFromName(executionId),
      );
      return executionFor(ctx, workflow);
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
