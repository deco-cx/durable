import { DB, WorkflowExecution } from "../backends/backend.ts";
import { Metadata } from "../context.ts";
import { WorkflowRegistry } from "../registry/registries.ts";
import { HistoryEvent, newEvent } from "../runtime/core/events.ts";
import { Arg } from "../types.ts";

/**
 * WorkflowCreationOptions is used for creating workflows of a given executionId.
 */
export interface WorkflowCreationOptions<
  TMetadata extends Metadata = Metadata,
> {
  executionId?: string;
  alias: string;
  metadata?: TMetadata;
}
export interface Pagination<T> {
  page: number;
  pageSize: number;
  items: T[];
}

export class WorkflowService {
  constructor(
    protected backend: DB,
    protected registry: WorkflowRegistry,
  ) {
  }
  /**
   * Cancel the workflow instance execution.
   */

  public cancelExecution(
    executionId: string,
    reason?: string,
  ): Promise<void> {
    return this.backend.execution(executionId).pending.add({
      ...newEvent(),
      type: "workflow_canceled",
      reason,
    });
  }

  /**
   * executionHistory execution gets the execution history
   * @param executionId the executionId.
   * @returns the history pagination
   */
  public async executionHistory(
    executionId: string,
    page = 0,
    pageSize = 10,
  ): Promise<Pagination<HistoryEvent>> {
    const items = await this.backend.execution(executionId).history.get({
      page,
      pageSize,
    });
    return {
      page,
      pageSize,
      items,
    };
  }

  /**
   * Get execution gets the execution from the database
   * @param executionId the executionId.
   * @returns the workflow execution
   */
  public async getExecution(
    executionId: string,
  ): Promise<WorkflowExecution | undefined> {
    return await this.backend.execution(executionId).get();
  }

  /**
   * Make the execution run.
   */
  public async touchExecution(
    executionId: string,
  ): Promise<void> {
    await this.backend.execution(executionId).pending.add();
  }

  /**
   * Signal the workflow with the given signal and payload.
   */
  public async signalExecution(
    executionId: string,
    signal: string,
    payload?: unknown,
  ): Promise<void> {
    await this.backend.execution(executionId).pending.add({
      ...newEvent(),
      type: "signal_received",
      signal,
      payload,
    });
  }

  /**
   * Creates a new workflow based on the provided options and returns the newly created workflow execution.
   * @param options the workflow creation options
   * @param input the workflow input
   */
  public startExecution<TArgs extends Arg = Arg>(
    { alias, executionId, metadata }: WorkflowCreationOptions,
    input?: [...TArgs],
  ): Promise<WorkflowExecution> {
    const wkflowInstanceId = executionId ?? crypto.randomUUID();
    return this.backend.execution(wkflowInstanceId).withinTransaction(
      async (executionsDB) => {
        const execution: WorkflowExecution = {
          alias,
          id: wkflowInstanceId,
          status: "running",
          metadata,
          input,
        };
        await executionsDB.create(execution); // cannot be parallelized
        await executionsDB.pending.add({
          ...newEvent(),
          type: "workflow_started",
          input,
        });
        return execution;
      },
    );
  }
}
