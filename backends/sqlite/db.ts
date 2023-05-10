import { HistoryEvent } from "../../runtime/core/events.ts";
import {
  DB,
  Events,
  Execution,
  PaginationParams,
  PendingExecution,
  WorkflowExecution,
} from "../backend.ts";
import {
  deleteEvents,
  insertEvents,
  PersistedEvent,
  queryHistory,
  toHistoryEvent,
} from "../postgres/events.ts";
import { queryPendingEvents } from "./events.ts";
import {
  getExecution,
  insertExecution,
  unlockExecution,
  updateExecution,
} from "../postgres/executions.ts";
import { pendingExecutionsSQLite } from "./executions.ts";

import schema from "./schema.ts";
import { DB as DBSqlite } from "https://deno.land/x/sqlite@v3.7.2/mod.ts";

const processJSON = (row: Record<string, any>) => {
  const processRowAndColumn = (row: Record<string, any>, column: string) => {
    if (row[column]) {
      row[column] = JSON.parse(row[column]);
    }
  };
  ["input", "output", "metadata", "attributes"].forEach((col) =>
    processRowAndColumn(row, col)
  );
  return row;
};

const eventsFor = (
  executionId: string,
  table: string,
  eventsQuery: string,
): Events => {
  return {
    add: (...events: [...HistoryEvent[]]) => {
      return Promise.resolve(
        db.execute(insertEvents(table, executionId, events)),
      );
    },
    del: (...events: [...HistoryEvent[]]) => {
      return Promise.resolve(
        db.execute(deleteEvents(table, executionId, events)),
      );
    },
    get: (paginationParams?: PaginationParams) => {
      const pageSize = paginationParams?.pageSize;
      const page = paginationParams?.page;
      const events = db.queryEntries(
        pageSize !== undefined && page !== undefined
          ? `${eventsQuery.replace("ASC", "DESC")} LIMIT ${pageSize} OFFSET ${
            pageSize * page
          }`
          : eventsQuery,
      );
      const result = events as unknown as PersistedEvent[];
      result.forEach(processJSON);
      return Promise.resolve(result.map(
        toHistoryEvent,
      ));
    },
  };
};

const executionsFor = () => (executionId: string): Execution => {
  return {
    pending: eventsFor(
      executionId,
      "pending_events",
      queryPendingEvents(executionId),
    ),
    history: eventsFor(
      executionId,
      "history",
      queryHistory(executionId),
    ),
    get: () => {
      const row = db.queryEntries(getExecution(executionId))?.[0];
      if (!row) {
        return Promise.resolve(undefined);
      }
      processJSON(row);
      const result = row as unknown as WorkflowExecution & {
        completedat: Date;
      };
      const { completedat: _ignore, ...rest } = {
        ...result,

        completedAt: result?.completedat,
      };
      return Promise.resolve(rest);
    },
    create: (execution: WorkflowExecution) => {
      return Promise.resolve(
        db.execute(insertExecution(executionId, execution)),
      );
    },
    update: (execution: WorkflowExecution) => {
      return Promise.resolve(
        db.execute(updateExecution(executionId, execution)),
      );
    },
  };
};

function dbFor(): DB {
  return {
    execution: executionsFor(),
    withinTransaction: async <TResult>(
      exec: (db: DB) => Promise<TResult>,
    ): Promise<TResult> => {
      return await exec(dbFor());
    },
    pendingExecutions: (
      lockTimeoutMS: number,
      limit: number,
    ): Promise<PendingExecution[]> => {
      return Promise.resolve(
        db.queryEntries<{ id: string }>(
          pendingExecutionsSQLite(lockTimeoutMS, limit),
        )
          .map(
            ({ id: execution }) => ({
              execution,
              unlock: async () => {
                await db.execute(unlockExecution(execution));
              },
            }),
          ),
      );
    },
  };
}

const db = new DBSqlite("test.db");
db.execute(schema);

export const sqlite = () => dbFor();
