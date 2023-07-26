import { Execution } from "../../backends/backend.ts";
import { Metadata, WorkflowContext } from "../../context.ts";
import { Arg } from "../../types.ts";
import { Command } from "./commands.ts";

import { WorkflowService } from "../../api/service.ts";
import { WorkflowExecution } from "../../backends/backend.ts";
import { handleCommand } from "../../runtime/core/commands.ts";
import { apply, HistoryEvent } from "../../runtime/core/events.ts";
import { WorkflowState, zeroState } from "../../runtime/core/state.ts";
import { runtimeBuilder } from "../builders.ts";

/**
 * WorkflowGen is the generator function returned by a workflow function.
 */
export type WorkflowGen<TResp extends unknown = unknown> = Generator<
  Command,
  TResp | undefined,
  // deno-lint-ignore no-explicit-any
  any
>;

/**
 * WorkflowGenFn is a function that returns a workflow generator function.
 */
export type WorkflowGenFn<
  TArgs extends Arg = Arg,
  TResp extends unknown = unknown,
> = (...args: [...TArgs]) => WorkflowGen<TResp>;

export type NoArgWorkflowFn<TResp = unknown> = () => WorkflowGen<TResp>;

/**
 * a typeguard for checking if the workflow function requires arguments.
 */
export const isNoArgFn = function <TArgs extends Arg = Arg, TResp = unknown>(
  fn: WorkflowGenFn<TArgs, TResp>,
): fn is NoArgWorkflowFn<TResp> {
  return fn.length == 0;
};

export type Workflow<
  TArgs extends Arg = Arg,
  TResp = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
> = {
  dispose?: () => void;
  (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResp>;
};

const workflowExecutionHandler = <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  workflow: Workflow<TArgs, TResult, WorkflowContext<Metadata>>,
) =>
async (
  executionId: string,
  workflowExecution: WorkflowExecution<TArgs, TResult, Metadata>,
  execution: Execution,
) => {
  try {
    const [history, pendingEvents] = await Promise.all([
      execution.history.get(),
      execution.pending.get(),
    ]);

    const ctx = new WorkflowContext(
      { ...workflowExecution, id: executionId },
    );
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
    let loopErr: null | any = null;
    while (
      state.canceledAt === undefined &&
      !state.hasFinished &&
      !state.current.isReplaying
    ) {
      try {
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
      } catch (err) {
        loopErr = err;
        console.log("stopping loop because of err", err);
        break;
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
    if (loopErr !== null) {
      throw loopErr;
    }
  } finally {
		console.log("disposing...")
    workflow?.dispose?.();
  }
};

export const runWorkflow = <TArgs extends Arg = Arg, TResult = unknown>(
  clientDb: Execution,
  svc: WorkflowService,
) => {
  return clientDb.withinTransaction(async (executionDB) => {
    const maybeInstance = await executionDB.get<TArgs, TResult>();
    if (maybeInstance === undefined) {
      throw new Error("workflow not found");
    }
    const workflow = maybeInstance
      ? await runtimeBuilder[maybeInstance.workflow.type](
        maybeInstance.workflow,
        await svc.getSignedToken(maybeInstance.namespace),
      )
      : undefined;

    if (workflow === undefined) {
      throw new Error("workflow not found");
    }
    const handler = workflowExecutionHandler<TArgs, TResult>(workflow);
    return handler(maybeInstance.id, maybeInstance, executionDB);
  });
};
