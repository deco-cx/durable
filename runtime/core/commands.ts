// deno-lint-ignore-file no-explicit-any
import { WorkflowService } from "../../api/service.ts";
import { Activity } from "../../context.ts";
import { isAwaitable, PromiseOrValue } from "../../promise.ts";
import { signedFetch } from "../../security/fetch.ts";
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

/**
 * (TODO) mcandeia fix this
 * For now only awaitable commands are supported
 */
export type AwaitableCommands = SleepCommand | WaitForSignalCommand;
export interface WaitAnyCommand extends CommandBase {
  name: "wait_any";
  commands: AwaitableCommands[];
}

export interface WaitAllCommand extends CommandBase {
  name: "wait_all";
  commands: AwaitableCommands[];
}

export interface StoreLocalAcitivtyResult<TResult> extends CommandBase {
  name: "store_local_activity_result";
  result?: TResult;
  activityName?: string;
  activityParams?: unknown;
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
 * Invoke the given http endpoint
 */
export interface InvokeHttpEndpointCommand extends CommandBase {
  name: "invoke_http_endpoint";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  responseFormat?: "complete" | "body-only";
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
  result?: TResult;
  exception?: unknown;
}

export interface LocalActivityCommand<
  TResult = unknown,
  TArgs extends Arg = Arg,
> extends CommandBase {
  name: "local_activity";
  args?: [...TArgs];
  fn: (...args: [...TArgs]) => PromiseOrValue<TResult>;
}

export interface CancelWorkflowCommand extends CommandBase {
  name: "cancel_workflow";
  reason?: string;
}

export type Command =
  | WaitAllCommand
  | WaitAnyCommand
  | StoreLocalAcitivtyResult<any>
  | CancelWorkflowCommand
  | NoOpCommand
  | SleepCommand
  | ScheduleActivityCommand<any, any>
  | WaitForSignalCommand
  | FinishWorkflowCommand<any>
  | DelegatedCommand
  | LocalActivityCommand<any, any>
  | InvokeHttpEndpointCommand;

const no_op = () => [];

const store_local_activity_result = (
  { result, activityName, activityParams }: StoreLocalAcitivtyResult<any>,
): HistoryEvent[] => [{
  ...newEvent(),
  type: "local_activity_called",
  activityName,
  activityParams,
  result,
}];

const toCommandResult = (state: WorkflowState) => (cmd: Command) =>
  handleCommand(cmd, state);

/**
 * Wait Any changes the current workflow function to have three parallel cached execution, the first finished will be used
 */
const wait_any = async (
  { commands, isReplaying }: WaitAnyCommand,
  state: WorkflowState,
): Promise<HistoryEvent[]> => {
  if (isReplaying) {
    return [];
  }
  const events = await Promise.all(commands.map(toCommandResult(state)));

  return [{
    ...newEvent(),
    type: "waiting_any",
    commands: commands.map((cmd) => cmd.name),
  }, ...events.flatMap((e) => e)];
};

const wait_all = async (
  { commands, isReplaying }: WaitAllCommand,
  state: WorkflowState,
): Promise<HistoryEvent[]> => {
  if (isReplaying) {
    return [];
  }
  const events = await Promise.all(commands.map(toCommandResult(state)));
  return [{
    ...newEvent(),
    type: "waiting_all",
    commands: commands.map((cmd) => cmd.name),
  }, ...events.flatMap((e) => e)];
};

const all = async (
  { commands, isReplaying }: WaitAnyCommand,
  state: WorkflowState,
): Promise<HistoryEvent[]> => {
  if (isReplaying) {
    return [];
  }
  return await Promise.race(
    commands.map((cmd) => handleCommand(cmd, state)),
  );
};

const local_activity = async (
  { fn, args }: LocalActivityCommand,
): Promise<HistoryEvent[]> => [{
  ...newEvent(),
  type: "local_activity_called",
  activityName: fn.name,
  activityParams: args,
  result: await fn(args),
}];

const sleep = ({ isReplaying, until }: SleepCommand): HistoryEvent[] => {
  if (isReplaying) {
    return [];
  }
  const timerId = crypto.randomUUID();
  return [
    {
      ...newEvent(),
      type: "timer_scheduled",
      timerId,
      until,
    },
    {
      ...newEvent(),
      type: "timer_fired",
      timestamp: until,
      visibleAt: until,
      timerId,
    },
  ];
};

const finish_workflow = (
  { result, exception }: FinishWorkflowCommand,
): HistoryEvent[] => [
  {
    ...newEvent(),
    result,
    exception,
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

const invoke_http_endpoint = async (
  { headers, url, method, body, responseFormat }: InvokeHttpEndpointCommand,
): Promise<HistoryEvent[]> => {
  const resp = await signedFetch(url, {
    headers,
    method,
    body,
  });

  const hd: Record<string, string> = {};

  for (const [k, v] of resp.headers.entries()) {
    hd[k] = v;
  }

  let respBody = undefined;
  if (resp.ok) {
    if (resp.headers.get("content-type") === "application/json") {
      respBody = await resp.json();
    } else {
      respBody = await resp.text().catch((err) => {
        console.error("error when parsing resp body", err);
        return "";
      });
    }
  } else {
    respBody = await resp.text();
  }
  return [{
    ...newEvent(),
    url,
    responseFormat,
    type: "invoke_http_response",
    body: respBody, // FIXME(mcandeia) should we format other type of http formats?
    status: resp.status,
    headers: hd,
  }];
};

const handleByCommand: Record<
  Command["name"],
  (
    c: any,
    state: WorkflowState<any, any>,
  ) => PromiseOrValue<HistoryEvent[]>
> = {
  no_op,
  sleep,
  finish_workflow,
  schedule_activity,
  wait_signal,
  delegated,
  local_activity,
  cancel_workflow,
  invoke_http_endpoint,
  store_local_activity_result,
  wait_any,
  wait_all,
};

export const handleCommand = async <TArgs extends Arg = Arg, TResult = unknown>(
  c: Command,
  state: WorkflowState<TArgs, TResult>,
): Promise<HistoryEvent[]> => {
  const promiseOrValue = handleByCommand[c.name](c, state);
  return isAwaitable(promiseOrValue) ? await promiseOrValue : promiseOrValue;
};

export const runLocalActivity = async (cmd: Command): Promise<Command> => {
  if (cmd.name === "local_activity") {
    return {
      name: "store_local_activity_result",
      activityName: cmd.fn.name,
      activityParams: cmd.args,
      result: await cmd.fn(...cmd?.args ?? []),
    };
  }
  return cmd;
};
