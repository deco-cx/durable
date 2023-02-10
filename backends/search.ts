import { HistoryEvent } from "../runtime/core/events.ts";
import { WorkflowExecution } from "./backend.ts";

export interface Pagination<T> {
  items: T[];
  count: number;
  total: number;
  page: number;
  totalPages: number;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface QueryExecutionParams extends PaginationParams {
  aliases?: string[];
}

/**
 * Used to make search to pending events
 */
export interface PendingEventsSearch {
  get(params: PaginationParams): Promise<Pagination<HistoryEvent>>;
}

/**
 * HistoryEventsSearch is used to search events on the execution history
 */
export interface HistoryEventsSearch {
  get(params: PaginationParams): Promise<Pagination<HistoryEvent>>;
}

/**
 * ExecutionSearch is the search operation that can be issued agaisnt executions
 */
export interface ExecutionSearch {
  get(): Promise<WorkflowExecution | undefined>;
  pending: PendingEventsSearch;
  history: HistoryEventsSearch;
}

/**
 * SearchDB is a search database with ACID-free capabilities.
 * You can use any eventual consistent database without any transacional concept invovled.
 * This will be used for querying data.
 */
export interface SearchDB {
  executions(
    params?: QueryExecutionParams,
  ): Promise<Pagination<WorkflowExecution>>;
  execution(id: string): ExecutionSearch;
}
