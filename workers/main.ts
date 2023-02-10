import { delay } from "https://deno.land/std@0.160.0/async/delay.ts";
import { Event, Queue } from "https://deno.land/x/async@v1.2.0/mod.ts";
import { postgres } from "../backends/postgres/db.ts";

import { tryParseInt } from "../utils.ts";
import { DB } from "../backends/backend.ts";
import { startWorkers, WorkItem } from "./worker.ts";
import {
  buildWorkflowRegistry,
  WorkflowRegistry,
} from "../registry/registries.ts";
import { WorkflowContext } from "../context.ts";
import { handleCommand } from "../runtime/core/commands.ts";
import { WorkflowState, zeroState } from "../runtime/core/state.ts";
import { WorkflowGen, WorkflowGenFn } from "../runtime/core/workflow.ts";
import { Arg } from "../types.ts";
import { apply, HistoryEvent } from "../runtime/core/events.ts";

export interface HandlerOpts {
  cancellation?: Event;
  concurrency?: number;
}

const MAX_LOCK_MINUTES = tryParseInt(Deno.env.get("WORKERS_LOCK_MINUTES")) ??
  10;

const DELAY_WHEN_NO_PENDING_EVENTS_MS =
  tryParseInt(Deno.env.get("PG_INTERVAL_EMPTY_EVENTS")) ?? 15_000;

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

    if (executionIds == true) {
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

const workflowHandler =
  (client: DB, registry: WorkflowRegistry) =>
  async <TArgs extends Arg = Arg, TResult = unknown>(executionId: string) => {
    await client.withinTransaction(async (db) => {
      const executionDB = db.execution(executionId);
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

      const [history, pendingEvents] = await Promise.all([
        executionDB.history.get(),
        executionDB.pending.get(),
      ]);

      const ctx = new WorkflowContext(executionId);
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
        executionDB.pending.del(...pendingEvents),
        executionDB.history.add(
          ...pendingEvents.map((event) => ({ ...event, seq: ++lastSeq })),
        ),
      ];

      if (asPendingEvents.length !== 0) {
        opts.push(executionDB.pending.add(...asPendingEvents));
      }

      opts.push(
        executionDB.update({
          ...maybeInstance,
          status: state.status,
          output: state.output,
          completedAt: state.hasFinished ? new Date() : undefined,
        }),
      );

      await Promise.all(opts);
    });
  };

const run = async (
  db: DB,
  { cancellation, concurrency }: HandlerOpts,
) => {
  const workerCount = concurrency ?? 1;
  const q = new Queue<WorkItem<string>>(workerCount);
  await startWorkers(
    workflowHandler(db, await buildWorkflowRegistry()),
    executionsGenerator(
      db,
      () => workerCount - q.qsize(),
      cancellation ?? new Event(),
    ),
    workerCount,
    q,
  );
};

const WORKER_COUNT = tryParseInt(Deno.env.get("WORKERS_COUNT")) ?? 10;
const cancellation = new Event();
Deno.addSignalListener("SIGINT", () => {
  cancellation.set();
});

Deno.addSignalListener("SIGTERM", () => {
  cancellation.set();
});

await run(postgres(), { cancellation, concurrency: WORKER_COUNT });
await cancellation.wait();
Deno.exit(0);
