import { WorkflowGen } from "../../sdk/deno/mod.ts";
import { Arg } from "../../types.ts";
import { Command } from "./commands.ts";
import { WorkflowState } from "./state.ts";
import { isNoArgFn } from "./workflow.ts";

/**
 * Event is the base event
 */
export interface Event {
  type: string;
  id: string;
  timestamp: Date;
  seq: number;
  visibleAt?: Date;
}

export interface NoOpEvent extends Event {
  type: "no_op";
  reason?: string;
}

export type CommandResults = Partial<Record<Command["name"], HistoryEvent[]>>;
export interface WaitingAnyEvent extends Event {
  type: "waiting_any";
  commands: string[];
}

export interface WaitingAllEvent extends Event {
  type: "waiting_all";
  commands: string[];
}
/**
 * WorkflowStartedEvent is the event that should start the workflow
 */
export interface InvokeHttpResponseEvent<TBody = unknown> extends Event {
  type: "invoke_http_response";
  body?: TBody;
  headers: Record<string, string>;
  url: string;
  status: number;
  responseFormat?: "complete" | "body-only";
}

/**
 * WorkflowStartedEvent is the event that should start the workflow
 */
export interface WorkflowStartedEvent<TArgs extends Arg = Arg> extends Event {
  type: "workflow_started";
  input?: TArgs;
}

/**
 * WorkflowStartedEvent is the event that should start the workflow
 */
export interface WorkflowFinishedEvent<TResult = unknown> extends Event {
  type: "workflow_finished";
  result?: TResult;
  exception?: unknown;
}

/**
 * WorkflowCanceledEvent is a event that will cancel the workflow
 */
export interface WorkflowCanceledEvent extends Event {
  type: "workflow_canceled";
  reason?: string;
}

/**
 * ActivityStartedEvent is the event that is raised when the activity starts.
 */
export interface ActivityStartedEvent<TArgs extends Arg = Arg> extends Event {
  input?: TArgs;
  type: "activity_started";
  activityName: string;
}

/**
 * TimerScheduledEvent is the event that is raised when a timer is scheduled.
 */
export interface TimerScheduledEvent extends Event {
  type: "timer_scheduled";
  until: Date;
  timerId: string;
}

/**
 * TimerFiredEvent is the event that is raised when a timer is fired.
 */
export interface TimerFiredEvent extends Event {
  type: "timer_fired";
  timerId: string;
}

/**
 * Raised when an activity is in completed state.
 */
export interface ActivityCompletedEvent<TResult = unknown> extends Event {
  result?: TResult;
  exception?: unknown;
  activityName: string;
  type: "activity_completed";
}

/**
 * WaitingSignalEvent is used to indicate that the state is waiting for signal to proceed.
 */
export interface WaitingSignalEvent extends Event {
  signal: string;
  type: "waiting_signal";
}

export interface SignalReceivedEvent extends Event {
  type: "signal_received";
  signal: string;
  payload?: unknown;
}

export interface LocalActivityCalledEvent<TResult = unknown> extends Event {
  type: "local_activity_called";
  result: TResult;
  activityName?: string;
  activityParams?: unknown;
}

/**
 * All possible types of events.
 */
export type HistoryEvent =
  | NoOpEvent
  | WorkflowStartedEvent
  | WorkflowFinishedEvent
  | WorkflowCanceledEvent
  | ActivityStartedEvent
  | ActivityCompletedEvent
  | TimerScheduledEvent
  | TimerFiredEvent
  | WaitingSignalEvent
  | SignalReceivedEvent
  | LocalActivityCalledEvent
  | InvokeHttpResponseEvent
  | WaitingAllEvent
  | WaitingAnyEvent;

export const newEvent = (): Omit<Event, "type"> => {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    seq: 0,
  };
};

type EventHandler<TEvent extends HistoryEvent = HistoryEvent> = (
  state: WorkflowState,
  event: TEvent,
) => WorkflowState;

const next = <TArgs extends Arg = Arg, TResult = unknown>(
  {
    done,
    value,
  }: IteratorResult<Command, TResult>,
  state: WorkflowState<TArgs, TResult>,
): WorkflowState<TArgs, TResult> => {
  const current: Command = done
    ? { result: value, name: "finish_workflow" }
    : value;
  const newState = { ...state, current };
  if (isBarrier<TArgs, TResult>(state.generatorFn!)) {
    return state.generatorFn!.tryBreak(newState);
  }
  return newState;
};

export const no_op = function <TArgs extends Arg = Arg, TResult = unknown>(
  state: WorkflowState<TArgs, TResult>,
  _: HistoryEvent,
): WorkflowState<TArgs, TResult> {
  return state;
};

export const waiting_any = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { commands }: WaitingAnyEvent,
): WorkflowState<TArgs, TResult> {
  return {
    ...state,
    status: "sleeping",
    current: { ...state.current, isReplaying: true },
    generatorFn: withBarrierOf(commands.length, state.generatorFn!, true),
  };
};

export const waiting_all = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { commands }: WaitingAllEvent,
): WorkflowState<TArgs, TResult> {
  return {
    ...state,
    status: "sleeping",
    current: { ...state.current, isReplaying: true },
    generatorFn: withBarrierOf(commands.length, state.generatorFn!),
  };
};

export const waiting_signal = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { signal }: WaitingSignalEvent,
): WorkflowState<TArgs, TResult> {
  return {
    ...state,
    status: "sleeping",
    current: { ...state.current, isReplaying: true },
    signals: { [signal]: state.generatorFn! },
  };
};

export const signal_received = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { signal, payload }: SignalReceivedEvent,
): WorkflowState<TArgs, TResult> {
  const signalFn = state.signals[signal];
  if (signalFn === undefined) {
    return state;
  }
  return next(signalFn.next(payload), {
    ...state,
    status: "running",
    signals: { [signal]: undefined },
  });
};

const timer_scheduled = function <TArgs extends Arg = Arg, TResult = unknown>(
  state: WorkflowState<TArgs, TResult>,
  { timerId }: TimerScheduledEvent,
): WorkflowState<TArgs, TResult> {
  return {
    ...state,
    current: { ...state.current, isReplaying: true },
    timers: { [timerId]: state.generatorFn! },
    status: "sleeping",
  };
};

const timer_fired = function <TArgs extends Arg = Arg, TResult = unknown>(
  state: WorkflowState<TArgs, TResult>,
  { timerId }: TimerFiredEvent,
): WorkflowState<TArgs, TResult> {
  const timerFn = state.timers[timerId];
  if (timerFn === undefined) {
    return state;
  }
  return next(timerFn.next(), {
    ...state,
    status: "running",
    timers: { [timerId]: undefined },
  });
};

const workflow_canceled = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { timestamp: canceledAt }: WorkflowCanceledEvent,
): WorkflowState<TArgs, TResult> {
  return { ...state, canceledAt, status: "canceled" };
};

const activity_completed = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { exception, result }: ActivityCompletedEvent<TResult>,
): WorkflowState<TArgs, TResult> {
  try {
    const genResult = exception
      ? state.generatorFn!.throw(exception)
      : state.generatorFn!.next(result);
    return next(genResult, state);
  } catch (err) {
    return { ...state, exception: err, hasFinished: true };
  }
};

const activity_started = function <TArgs extends Arg = Arg, TResult = unknown>(
  state: WorkflowState<TArgs, TResult>,
  _: ActivityStartedEvent<TArgs>,
): WorkflowState<TArgs, TResult> {
  return { ...state, current: { ...state.current, isReplaying: true } }; // TODO check if this event comes from current command by comparing ids.
};

const workflow_finished = function <TArgs extends Arg = Arg, TResult = unknown>(
  state: WorkflowState<TArgs, TResult>,
  { result: output, timestamp: finishedAt, exception }: WorkflowFinishedEvent<
    TResult
  >,
): WorkflowState<TArgs, TResult> {
  if (exception) {
		// state.generatorFn!.throw(exception);
    return {
      ...state,
      hasFinished: true,
      status: "completed",
      exception,
      finishedAt,
    };
  }
  state.generatorFn!.return(output);
  return {
    ...state,
    hasFinished: true,
    finishedAt,
    output,
    status: "completed",
  };
};

const workflow_started = function <TArgs extends Arg = Arg, TResult = unknown>(
  state: WorkflowState<TArgs, TResult>,
  { input, timestamp }: WorkflowStartedEvent<TArgs>,
): WorkflowState<TArgs, TResult> {
  const workflowFn = state.workflowFn;
  const generatorFn = input
    ? workflowFn(...input)
    : isNoArgFn(workflowFn)
    ? workflowFn()
    : undefined;

  if (generatorFn === undefined) {
    throw new Error("input not provided for genfn func");
  }
  const nextCmd = generatorFn.next();

  return next(nextCmd, {
    ...state,
    startedAt: timestamp,
    generatorFn,
    status: "running",
  });
};

const local_activity_called = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  // deno-lint-ignore no-explicit-any
  { result }: LocalActivityCalledEvent<any>,
): WorkflowState<TArgs, TResult> {
  return next(state.generatorFn!.next(result), state);
};

const invoke_http_response = function <
  TArgs extends Arg = Arg,
  TResult = unknown,
>(
  state: WorkflowState<TArgs, TResult>,
  { body, headers, status, responseFormat, timestamp }: InvokeHttpResponseEvent,
): WorkflowState<TArgs, TResult> {
  try {
    const genResult = status >= 400
      ? state.generatorFn!.throw({
        message: "Error when fetching API",
        response: { body, headers, status },
      })
      : state.generatorFn!.next(
        responseFormat && responseFormat === "complete"
          ? { body, headers, status }
          : body,
      );
    return next(genResult, state);
  } catch (err) {
    return {
      ...state,
      exception: err,
      status: "completed",
      hasFinished: true,
      finishedAt: timestamp,
    };
  }
};

class Barrier<TArgs extends Arg = Arg, TResult = unknown>
  implements WorkflowGen<TResult> {
  results: Array<any>;
  canBreak = false;
  constructor(
    private size: number,
    public genFn: WorkflowGen<TResult>,
    private first = false,
  ) {
    this.results = new Array<any>();
  }

  tryBreak(
    state: WorkflowState<TArgs, TResult>,
  ): WorkflowState<TArgs, TResult> {
    if (!this.canBreak) {
      return state;
    }
    return { ...state, signals: {}, timers: {}, generatorFn: this.genFn };
  }

  next(...args: [] | [any]): IteratorResult<Command, TResult | undefined> {
    this.results.push(...args);
    if ((this.results.length >= this.size) || this.first) {
      this.canBreak = true;
      if (this.first) {
        return this.genFn.next(this.results[0]);
      }
      return this.genFn.next(this.results);
    }
    return {
      done: false,
      value: { name: "no_op" },
    };
  }
  return(
    value: TResult | undefined,
  ): IteratorResult<Command, TResult | undefined> {
    return this.genFn.return(value);
  }
  throw(e: any): IteratorResult<Command, TResult | undefined> {
    return this.genFn.throw(e);
  }
  [Symbol.iterator](): Generator<Command, TResult | undefined, any> {
    return this.genFn[Symbol.iterator]();
  }
}
const isBarrier = <TArgs extends Arg = Arg, TResult = unknown>(
  genFn: Barrier<TArgs, TResult> | WorkflowGen<TResult>,
): genFn is Barrier<TArgs, TResult> => {
  return (genFn as Barrier<TArgs, TResult>).canBreak !== undefined;
};

const withBarrierOf = <TArgs extends Arg = Arg, TResult = unknown>(
  size: number,
  genFn: WorkflowGen<TResult>,
  first = false,
): Barrier<TArgs, TResult> => {
  return new Barrier<TArgs, TResult>(size, genFn, first);
};

// deno-lint-ignore no-explicit-any
const handlers: Record<HistoryEvent["type"], EventHandler<any>> = {
  workflow_canceled,
  activity_completed,
  activity_started,
  workflow_finished,
  workflow_started,
  timer_scheduled,
  timer_fired,
  waiting_signal,
  signal_received,
  local_activity_called,
  invoke_http_response,
  waiting_any,
  waiting_all,
  no_op,
};

export function apply<TArgs extends Arg = Arg, TResult = unknown>(
  workflowState: WorkflowState<TArgs, TResult>,
  event: HistoryEvent,
): WorkflowState<TArgs, TResult> {
  return handlers[event.type](
    workflowState as WorkflowState,
    event,
  ) as WorkflowState<TArgs, TResult>;
}
