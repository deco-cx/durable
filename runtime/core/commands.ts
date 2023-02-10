// deno-lint-ignore-file no-explicit-any
import { Activity } from "../../context.ts";
import { isAwaitable, PromiseOrValue } from "../../promise.ts";
import { Arg } from "../../types.ts";
import { ActivityStartedEvent, HistoryEvent, newEvent } from "./events.ts";
import { WorkflowState } from "./state.ts";

/**
 * A Durable Command.
 */
export interface CommandBase {
  /**
   * the name of the command
   */
  name: string;
  /**
   * isReplaying
   */
  isReplaying?: boolean;
}

export interface NoOpCommand extends CommandBase {
  name: "no_op";
}

export interface DelegatedCommand extends CommandBase {
  name: "delegated";
  getCmd: () => Promise<Command>;
}

/**
 * SleepCommand used to stop execution until reached the specified date.
 */
export interface SleepCommand extends CommandBase {
  name: "sleep";
  until: Date;
}

/**
 * ScheduleActivityCommand is used for scheduling long running tasks.
 */
export interface ScheduleActivityCommand<
  TArgs extends Arg = Arg,
  TResult = unknown,
> extends CommandBase {
  activity: Activity<TArgs, TResult>;
  input: [...TArgs];
  name: "schedule_activity";
}

export interface WaitForSignalCommand extends CommandBase {
  name: "wait_signal";
  signal: string;
}

export interface FinishWorkflowCommand<TResult = unknown> extends CommandBase {
  name: "finish_workflow";
  result: TResult;
}

export interface LocalActivityCommand<TResult = unknown> extends CommandBase {
  name: "local_activity";
  result: TResult;
}

export interface CancelWorkflowCommand extends CommandBase {
  name: "cancel_workflow";
  reason?: string;
}

export type Command =
  | CancelWorkflowCommand
  | NoOpCommand
  | SleepCommand
  | ScheduleActivityCommand<any, any>
  | WaitForSignalCommand
  | FinishWorkflowCommand<any>
  | DelegatedCommand
  | LocalActivityCommand<any>;

const no_op = () => [];
const local_activity = (
  { result }: LocalActivityCommand,
): HistoryEvent[] => [{ ...newEvent(), type: "local_activity_called", result }];

const sleep = ({ isReplaying, until }: SleepCommand): HistoryEvent[] => {
  if (isReplaying) {
    return [];
  }
  return [
    {
      ...newEvent(),
      type: "timer_scheduled",
      until,
    },
    {
      ...newEvent(),
      type: "timer_fired",
      timestamp: until,
      visibleAt: until,
    },
  ];
};

const finish_workflow = ({ result }: FinishWorkflowCommand): HistoryEvent[] => [
  {
    ...newEvent(),
    result,
    type: "workflow_finished",
  },
];

const cancel_workflow = ({ reason }: CancelWorkflowCommand): HistoryEvent[] => [
  {
    ...newEvent(),
    reason,
    type: "workflow_canceled",
  },
];

const schedule_activity = async <TArgs extends Arg = Arg, TResult = unknown>(
  { activity, input }: ScheduleActivityCommand<TArgs, TResult>,
): Promise<HistoryEvent[]> => {
  const started = new Date();
  const eventBase = {
    activityName: activity.name,
  };

  const startedEvent: ActivityStartedEvent<TArgs> = {
    ...newEvent(),
    ...eventBase,
    timestamp: started,
    activityName: activity.name,
    type: "activity_started",
    input: input,
  };

  try {
    const activityResult = activity(...input);
    const result = isAwaitable(activityResult)
      ? await activityResult
      : activityResult;
    return [
      startedEvent,
      {
        ...newEvent(),
        ...eventBase,
        type: "activity_completed",
        result,
      },
    ];
  } catch (error) {
    return [
      startedEvent,
      {
        ...newEvent(),
        ...eventBase,
        type: "activity_completed",
        exception: error,
      },
    ];
  }
};

const wait_signal = (
  { isReplaying, signal }: WaitForSignalCommand,
): HistoryEvent[] =>
  isReplaying ? [] : [
    {
      ...newEvent(),
      type: "waiting_signal",
      signal,
    },
  ];

const delegated = async (
  { getCmd, isReplaying }: DelegatedCommand,
  state: WorkflowState,
): Promise<HistoryEvent[]> => {
  if (isReplaying) {
    return [];
  }
  const cmd = await getCmd();
  return handleCommand(cmd, state);
};

const handleByCommand: Record<
  Command["name"],
  (c: any, state: WorkflowState<any, any>) => PromiseOrValue<HistoryEvent[]>
> = {
  no_op,
  sleep,
  finish_workflow,
  schedule_activity,
  wait_signal,
  delegated,
  local_activity,
  cancel_workflow,
};

export const handleCommand = async <TArgs extends Arg = Arg, TResult = unknown>(
  c: Command,
  state: WorkflowState<TArgs, TResult>,
): Promise<HistoryEvent[]> => {
  const promiseOrValue = handleByCommand[c.name](c, state);
  return isAwaitable(promiseOrValue) ? await promiseOrValue : promiseOrValue;
};
