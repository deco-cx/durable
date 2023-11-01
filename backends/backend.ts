import { Metadata } from "../context.ts";
import { PromiseOrValue } from "../promise.ts";
import { WorkflowRuntimeRef } from "../registry/registries.ts";
import { HistoryEvent } from "../runtime/core/events.ts";
import { Arg } from "../types.ts";

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}
/**
 * Events is the operation that can be executed against the events.
 */
export interface Events {
  stream?: (args?: { signal?: AbortSignal }) => Promise<Response>;
  add(...events: [...HistoryEvent[]]): Promise<void>;
  del(...events: [...HistoryEvent[]]): Promise<void>;
  get(pagination?: PaginationParams): Promise<HistoryEvent[]>;
}

export interface CreateOptions {
  restart?: boolean | null;
}
/**
 * Execution is all operations that can be executed in a given execution.
 */
export interface Execution {
  pending: Events;
  history: Events;
  get<
    TArgs extends Arg = Arg,
    TResult = unknown,
    TMetadata extends Metadata = Metadata,
  >(): Promise<WorkflowExecution<TArgs, TResult, TMetadata> | undefined>;
  create(execution: WorkflowExecution, options?: CreateOptions): Promise<void>;
  update(execution: WorkflowExecution): Promise<void>;
  /**
   * withintransaction executes commands inside a transaction providing the ACID guarantees
   * if the executor function returns an exception, the transaction should be rolled back, otherwise it should commit all changes atomically.
   * when executing the given function any operation should be inside a lock machanism avoiding double execution in progress.
   * @param f the execution func
   */
  withinTransaction<T>(
    f: (transactor: Execution) => PromiseOrValue<T>,
  ): Promise<T>;
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

export interface RuntimeParameters {
  http: {
    defaultHeaders: Record<string, string>;
  };
  websocket: {
    defaultQueryParams: Record<string, string>;
  };
}

export interface WorkflowExecutionBase<
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
> {
  id?: string;
  namespace?: string;
  workflow: WorkflowRuntimeRef;
  completedAt?: Date;
  metadata?: TMetadata;
  runtimeParameters?: RuntimeParameters;
  input?: TArgs;
  output?: TResult;
}
export interface WorkflowExecution<
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
> extends WorkflowExecutionBase<TArgs, TResult, TMetadata> {
  id: string;
  namespace: string;
  status: WorkflowStatus;
}
