import {
  DB,
  RuntimeParameters,
  WorkflowExecution,
  WorkflowExecutionBase,
} from "../backends/backend.ts";
import { Metadata } from "../context.ts";
import { WorkflowRuntimeRef } from "../registry/registries.ts";
import { HistoryEvent, newEvent } from "../runtime/core/events.ts";
import { JwtIssuer } from "../security/jwt.ts";
import { Arg } from "../types.ts";

export interface StartOptions {
  restart?: boolean | null;
}
/**
 * WorkflowCreationOptions is used for creating workflows of a given executionId.
 */
export interface WorkflowCreationOptions<
  TMetadata extends Metadata = Metadata,
> {
  executionId?: string;
  workflow: WorkflowRuntimeRef;
  namespace: string;
  metadata?: TMetadata;
  runtimeParameters?: RuntimeParameters;
}
export interface Pagination<T> {
  page: number;
  pageSize: number;
  items: T[];
}

export class WorkflowService {
  constructor(
    protected backend: DB,
    protected jwtIssuer: JwtIssuer,
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

  /** */
  public async executionHistoryStream(
    executionId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await this.backend.execution(executionId).history.stream!({
      signal,
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
   * Return a signed token used for the given audience.
   */
  public getSignedToken(namespace: string) {
    const iat = Date.now();
    return this.jwtIssuer.issue({
      sub: "urn:deco:service::workflows",
      aud: `urn:deco:site::${namespace}:`,
      iat,
      exp: iat + 600_000, // ten minutes duration
    });
  }

  /**
   * Creates a new workflow based on the provided options and returns the newly created workflow execution.
   * @param options the workflow creation options
   * @param input the workflow input
   */
  public startExecution<TArgs extends Arg = Arg>(
    _execution: WorkflowExecutionBase,
    startOptions: StartOptions = {},
    input?: [...TArgs],
  ): Promise<WorkflowExecution> {
    const namespace = _execution.namespace;
    if (!namespace) {
      throw new Error("namespace param is required");
    }
    const execution: WorkflowExecution = {
      id: crypto.randomUUID(),
      status: "running",
      namespace,
      ..._execution,
    };
    return this.backend.execution(execution.id).withinTransaction(
      async (executionsDB) => {
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
