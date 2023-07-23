import {
  WorkflowExecution,
  WorkflowExecutionBase,
} from "./backends/backend.ts";
import { ClientOptions, signal, start } from "./client/init.ts";
import { PromiseOrValue } from "./promise.ts";
import { makeRandomWithSeed } from "./randomSeed.ts";
import {
  AwaitableCommands,
  InvokeHttpEndpointCommand,
  LocalActivityCommand,
  ScheduleActivityCommand,
  SleepCommand,
  WaitAllCommand,
  WaitAnyCommand,
  WaitForSignalCommand,
} from "./runtime/core/commands.ts";
import { Arg } from "./types.ts";

export type ActivityResult<T> = PromiseOrValue<T>;
/**
 * Returns if the given activity result is a generator or not.
 * @param value the activity result
 * @returns a typeguard for activity result.
 */
export const isValue = <T>(value: ActivityResult<T>): value is T => {
  return (
    (value as Generator).next === undefined &&
    (value as Promise<T>).then === undefined
  );
};

/**
 * Activity is the signature of any activity.
 */
export type Activity<TArgs extends Arg, TResult> = (
  ...args: [...TArgs]
) => ActivityResult<TResult>;

/**
 * Activity executor receives an activity and executes it.
 */
export type ActivityExecutor<TArgs extends Arg, TResult> = (
  activity: Activity<TArgs, TResult>,
  ...args: [...TArgs]
) => ActivityResult<TResult>;

// deno-lint-ignore no-empty-interface
export interface Metadata {
}

/**
 * WorkflowContext is used for providing api access to the workflow engine.
 */
export class WorkflowContext<TMetadata extends Metadata = Metadata> {
  private rand: () => number;
  constructor(
    public execution: WorkflowExecution<Arg, unknown, TMetadata>,
  ) {
    this.rand = makeRandomWithSeed(execution.id);
  }

  /**
   * Start a new workflow execution
   */
  public startExecution(
    exec: WorkflowExecutionBase,
    opts?: ClientOptions,
  ): LocalActivityCommand {
    return this.callLocalActivity(() => start(exec, opts));
  }

  /**
   * Send a signal for the given workflow execution
   */
  public sendSignal(
    executionId: string,
    _signal: string,
    payload: unknown,
    opts?: ClientOptions,
  ): LocalActivityCommand {
    return this.callLocalActivity(() =>
      signal(executionId, _signal, payload, opts)
    );
  }
  /**
   * waitForSignal wait for the given signal to be occurred.
   * @param signal the signal name
   */
  public waitForSignal(signal: string): WaitForSignalCommand {
    return { name: "wait_signal", signal };
  }

  /**
   * Executes the activity for the given context and args.
   * @param activity the activity that should be executed
   * @param input the activity args (optionally)
   */
  public callActivity<TArgs extends Arg = Arg, TResult = unknown>(
    activity: Activity<TArgs, TResult>,
    ...input: [...TArgs]
  ): ScheduleActivityCommand<TArgs, TResult> {
    return { name: "schedule_activity", activity, input };
  }

  /**
   * Executes the activity for the given context and args.
   * @param activity the activity that should be executed
   */
  public callLocalActivity<TResult = unknown>(
    activity: () => PromiseOrValue<TResult>,
  ): LocalActivityCommand<TResult> {
    return { name: "local_activity", fn: activity };
  }

  /**
   * Executes the http request for the given context and args.
   * @param url the fetch url
   */
  public fetch(
    url: string,
    options?: {
      body?: string;
      headers?: Record<string, string>;
      method?: string;
    },
    format?: InvokeHttpEndpointCommand["responseFormat"],
  ): InvokeHttpEndpointCommand {
    return {
      name: "invoke_http_endpoint",
      url,
      ...options,
      responseFormat: format,
    };
  }

  /**
   * stop the current workflow execution and sleep the given miliseconds time.
   * @param sleepMs the time in miliseconds
   */
  public sleep(sleepMs: number): SleepCommand {
    // get the current date & time (as milliseconds since Epoch)
    const currentTimeAsMs = Date.now();

    const adjustedTimeAsMs = currentTimeAsMs + sleepMs;
    return this.sleepUntil(new Date(adjustedTimeAsMs));
  }

  /**
   * UNDER TEST, wait all has a bug where the items where delivered out of the order.
   * Wait until all commands has completed and return an array of results.
   */
  public _experimentalWaitAll(commands: AwaitableCommands[]): WaitAllCommand {
    return {
      name: "wait_all",
      commands,
    };
  }

  /**
   * Wait until any of commands has completed and return its result.
   */
  public waitAny(commands: AwaitableCommands[]): WaitAnyCommand {
    return {
      name: "wait_any",
      commands,
    };
  }

  /**
   * stops the current workflow execution and sleep until the given date.
   * @param until the date that should sleep.
   */
  public sleepUntil(until: Date): SleepCommand {
    return { name: "sleep", until };
  }

  /**
   * Returns a random consistent with the given workflow execution
   * @returns a random float value.
   */
  public random(): number {
    return this.rand();
  }

  /**
   * Logs at least once with additional workflow information
   */
  public log(message: any, ...optionalParams: any[]): LocalActivityCommand {
    const executionId = this.execution.id;
    const fn = function () {
      console.log(
        `[${new Date().toISOString()}][${executionId}]: ${message}`,
        ...optionalParams,
      );
    };
    Object.defineProperty(fn, "name", { value: "log" });
    return this.callLocalActivity(fn);
  }
}
