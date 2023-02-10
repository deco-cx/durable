import {
  makeSeededGenerators,
  RandomGenerators,
} from "https://raw.githubusercontent.com/alextes/vegas/main/mod.ts";
import { PromiseOrValue } from "./promise.ts";
import {
  LocalActivityCommand,
  ScheduleActivityCommand,
  SleepCommand,
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

/**
 * WorkflowContext is used for providing api access to the workflow engine.
 */
export class WorkflowContext {
  private rand: RandomGenerators;
  constructor(public executionId: string) {
    this.rand = makeSeededGenerators(executionId);
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
    activity: () => TResult,
  ): LocalActivityCommand<TResult> {
    return { name: "local_activity", result: activity() };
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
    return this.rand.randomInt(0, Number.MAX_SAFE_INTEGER);
  }
}
