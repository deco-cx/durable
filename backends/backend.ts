import { PromiseOrValue } from "../promise.ts";
import { HistoryEvent } from "../runtime/core/events.ts";
import { Arg } from "../types.ts";

/**
 * Events is the operation that can be executed against the events.
 */
export interface Events {
  add(...events: [...HistoryEvent[]]): Promise<void>;
  del(...events: [...HistoryEvent[]]): Promise<void>;
  get(): Promise<HistoryEvent[]>;
}

/**
 * Execution is all operations that can be executed in a given execution.
 */
export interface Execution {
  pending: Events;
  history: Events;
  get(): Promise<WorkflowExecution | undefined>;
  create(execution: WorkflowExecution): Promise<void>;
  update(execution: WorkflowExecution): Promise<void>;
}

/**
 * PendingExecution is a locked workflow execution pending to be executed.
 */
export interface PendingExecution {
  execution: string;
  unlock: () => Promise<void>;
}

export interface DB {
  /**
   * Execution returns the possible operations for a given execution.
   */
  execution(executionId: string): Execution;
  /**
   * PendingExecutions returns all workflow execution that has pending events and lock all of them using the specified lock time.
   * @param lockTimeMS is the time that the workflow execution should be locked
   * @param limit limit the query result.
   */
  pendingExecutions(
    lockTimeMS: number,
    limit: number,
  ): Promise<PendingExecution[]>;
  /**
   * withintransaction executes commands inside a transaction providing the ACID guarantees
   * if the executor function returns an exception, the transaction should be rolled back, otherwise it should commit all changes atomically.
   * when executing the given function any operation should be inside a lock machanism avoiding double execution in progress.
   * @param f the execution func
   */
  withinTransaction<T>(f: (transactor: DB) => PromiseOrValue<T>): Promise<T>;
}

export type WorkflowStatus =
  | "completed"
  | "canceled"
  | "sleeping"
  | "running";

export const WORKFLOW_NOT_COMPLETED: WorkflowStatus[] = [
  "running",
  "sleeping",
];
export interface WorkflowExecution<TArgs extends Arg = Arg, TResult = unknown> {
  id: string;
  alias: string;
  completedAt?: Date;
  status: WorkflowStatus;
  input?: TArgs;
  output?: TResult;
}
