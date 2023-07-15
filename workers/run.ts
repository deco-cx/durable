import { Execution } from "../backends/backend.ts";
import { WorkflowRegistry } from "../registry/registries.ts";
import { Arg } from "../types.ts";

import { WorkflowExecution } from "../backends/backend.ts";
import { Metadata, WorkflowContext } from "../context.ts";
import { handleCommand } from "../runtime/core/commands.ts";
import { apply, HistoryEvent } from "../runtime/core/events.ts";
import { WorkflowState, zeroState } from "../runtime/core/state.ts";
import {
  Workflow,
  WorkflowGen,
  WorkflowGenFn,
} from "../runtime/core/workflow.ts";

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
