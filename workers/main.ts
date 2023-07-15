import { Event } from "../async/event.js";

import { postgres } from "../backends/postgres/db.ts";

import { Queue } from "../async/queue.ts";
import { DB, Execution, WorkflowExecution } from "../backends/backend.ts";
import { Metadata, WorkflowContext } from "../context.ts";
import {
  buildWorkflowRegistry,
  WorkflowRegistry,
} from "../registry/registries.ts";
import { handleCommand } from "../runtime/core/commands.ts";
import { apply, HistoryEvent } from "../runtime/core/events.ts";
import { WorkflowState, zeroState } from "../runtime/core/state.ts";
import {
  Workflow,
  WorkflowGen,
  WorkflowGenFn,
} from "../runtime/core/workflow.ts";
import { Arg } from "../types.ts";
import { tryParseInt } from "../utils.ts";
import { startWorkers, WorkItem } from "./worker.ts";

export interface HandlerOpts {
  cancellation?: Event;
  concurrency?: number;
}

const MAX_LOCK_MINUTES = 10;

const DELAY_WHEN_NO_PENDING_EVENTS_MS = 15_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function* executionsGenerator(
  db: DB,
  freeWorkers: () => number,
  cancellation: Event,
): AsyncGenerator<WorkItem<string>, void, unknown> {
  while (!cancellation.is_set()) {
    const limit = freeWorkers();
    if (limit === 0) {
      await Promise.race([
        delay(DELAY_WHEN_NO_PENDING_EVENTS_MS),
        cancellation.wait(),
      ]);
      continue;
    }
    const executionIds = await Promise.race([
      db.pendingExecutions(MAX_LOCK_MINUTES, limit),
      cancellation.wait(),
    ]);

    if (typeof executionIds === "boolean") {
      break;
    }

    if (executionIds.length == 0) {
      await Promise.race([
        delay(DELAY_WHEN_NO_PENDING_EVENTS_MS),
        cancellation.wait(),
      ]);
      continue;
    }

    for (const { execution: item, unlock } of executionIds) {
      yield {
        item,
        onError: async (err) => {
          await unlock();
          throw err;
        },
        onSuccess: unlock,
      };
    }
  }
}
const workflowExecutionHandler = <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  workflow: Workflow<TArgs, TResult, WorkflowContext<Metadata>>,
) =>
async (
  executionId: string,
  workflowExecution: WorkflowExecution,
  execution: Execution,
) => {
  try {
    const [history, pendingEvents] = await Promise.all([
      execution.history.get(),
      execution.pending.get(),
    ]);

    const ctx = new WorkflowContext(executionId, workflowExecution.metadata);
    const workflowFn: WorkflowGenFn<TArgs, TResult> = (
      ...args: [...TArgs]
    ): WorkflowGen<TResult> => {
      return workflow(ctx, ...args);
    };

    let state: WorkflowState<TArgs, TResult> = [
      ...history,
      ...pendingEvents,
    ].reduce(apply, zeroState(workflowFn));

    const asPendingEvents: HistoryEvent[] = [];
    while (
      state.canceledAt === undefined &&
      !state.hasFinished &&
      !state.current.isReplaying
    ) {
      const newEvents = await handleCommand(state.current, state);
      if (newEvents.length === 0) {
        break;
      }
      for (const newEvent of newEvents) {
        if (newEvent.visibleAt === undefined) {
          state = apply(state, newEvent);
          pendingEvents.push(newEvent);
          if (
            state.canceledAt === undefined &&
            !state.hasFinished &&
            !state.current.isReplaying
          ) {
            break;
          }
        } else {
          asPendingEvents.push(newEvent);
        }
      }
    }

    let lastSeq = history.length === 0 ? 0 : history[history.length - 1].seq;

    const opts: Promise<void>[] = [
      execution.pending.del(...pendingEvents),
      execution.history.add(
        ...pendingEvents.map((event) => ({ ...event, seq: ++lastSeq })),
      ),
    ];

    if (asPendingEvents.length !== 0) {
      opts.push(execution.pending.add(...asPendingEvents));
    }

    opts.push(
      execution.update({
        ...workflowExecution,
        status: state.status,
        output: state.output,
        completedAt: state.hasFinished ? new Date() : undefined,
      }),
    );

    await Promise.all(opts);
  } finally {
    workflow?.dispose?.();
  }
};

export const runWorkflow = <TArgs extends Arg = Arg, TResult = unknown>(
  clientDb: Execution,
  registry: WorkflowRegistry,
) => {
  return clientDb.withinTransaction(async (executionDB) => {
    const maybeInstance = await executionDB.get();
    if (maybeInstance === undefined) {
      throw new Error("workflow not found");
    }
    const workflow = maybeInstance
      ? await registry.get<TArgs, TResult>(maybeInstance.alias)
      : undefined;

    if (workflow === undefined) {
      throw new Error("workflow not found");
    }
    const handler = workflowExecutionHandler(workflow);
    return handler(maybeInstance.id, maybeInstance, executionDB);
  });
};

const workflowHandler =
  (client: DB, registry: WorkflowRegistry) =>
  <TArgs extends Arg = Arg, TResult = unknown>(executionId: string) => {
    const executionDB = client.execution(executionId);
    return runWorkflow<TArgs, TResult>(executionDB, registry);
  };

const run = async (
  db: DB,
  registry: WorkflowRegistry,
  { cancellation, concurrency }: HandlerOpts,
) => {
  const workerCount = concurrency ?? 1;
  const q = new Queue<WorkItem<string>>();
  await startWorkers(
    workflowHandler(db, registry),
    executionsGenerator(
      db,
      () => workerCount - q.size,
      cancellation ?? new Event(),
    ),
    workerCount,
    q,
  );
};

export const start = async (db?: DB, registry?: WorkflowRegistry) => {
  const WORKER_COUNT = tryParseInt(process.env["WORKERS_COUNT"]) ?? 10;
  const cancellation = new Event();
  process.on("SIGINT", () => {
    cancellation.set();
  });

  process.on("SIGTERM", () => {
    cancellation.set();
  });

  await run(db ?? await postgres(), registry ?? await buildWorkflowRegistry(), {
    cancellation,
    concurrency: WORKER_COUNT,
  });
  await cancellation.wait();
  process.exit(0);
};
