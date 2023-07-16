import { Event } from "../async/event.js";

import { postgres } from "../backends/postgres/db.ts";

import { Queue } from "../async/queue.ts";
import { DB } from "../backends/backend.ts";
import {
  buildWorkflowRegistry,
  WorkflowRegistry,
} from "../registry/registries.ts";
import { runWorkflow } from "../runtime/core/workflow.ts";
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
