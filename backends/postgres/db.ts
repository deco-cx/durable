import { PoolClient, QueryResult, QueryResultRow } from "pg";
import { Metadata } from "../../context.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import { Arg } from "../../types.ts";
import { apply } from "../../utils.ts";
import {
  DB,
  Events,
  Execution,
  PaginationParams,
  PendingExecution,
  WorkflowExecution,
} from "../backend.ts";
import { usePool } from "./connect.ts";
import {
  deleteEvents,
  insertEvents,
  PersistedEvent,
  queryHistory,
  queryPendingEvents,
  toHistoryEvent,
} from "./events.ts";
import {
  getExecution,
  insertExecution,
  pendingExecutions,
  unlockExecution,
  updateExecution,
} from "./executions.ts";
import schema from "./schema.ts";

type UseClient = <TResult>(
  f: (client: PoolClient) => Promise<TResult>,
) => Promise<TResult>;

const unlockWkflowExecution = (executionId: string) => async () => {
  await usePool((client) => {
    client.query(unlockExecution(executionId));
  });
};

// TODO use queryarguments to avoid sql injection
const queryObject =
  <T extends QueryResultRow>(query: string, queryArguments?: string[]) =>
  (client: PoolClient): Promise<QueryResult<T>> => {
    return client.query<T, string[]>(query, queryArguments);
  };

const eventsFor = (
  useClient: UseClient,
  executionId: string,
  table: string,
  eventsQuery: string,
): Events => {
  return {
    add: async (...events: [...HistoryEvent[]]) => {
      await useClient(queryObject(insertEvents(table, executionId, events)));
    },
    del: async (...events: [...HistoryEvent[]]) => {
      await useClient(queryObject(deleteEvents(table, executionId, events)));
    },
    get: async (paginationParams?: PaginationParams) => {
      const pageSize = paginationParams?.pageSize;
      const page = paginationParams?.page;
      const events = await useClient(
        queryObject<PersistedEvent>(
          pageSize !== undefined && page !== undefined
            ? `${eventsQuery.replace("ASC", "DESC")} LIMIT ${pageSize} OFFSET ${
              pageSize * page
            }`
            : eventsQuery,
        ),
      );
      return events.rows.map(toHistoryEvent);
    },
  };
};

const executionsFor =
  (useClient: UseClient) => (executionId: string): Execution => {
    return {
      pending: eventsFor(
        useClient,
        executionId,
        "pending_events",
        queryPendingEvents(executionId),
      ),
      history: eventsFor(
        useClient,
        executionId,
        "history",
        queryHistory(executionId),
      ),
      get: <
        TArgs extends Arg = Arg,
        TResult = unknown,
        TMetadata extends Metadata = Metadata,
      >() =>
        useClient(
          queryObject<WorkflowExecution>(getExecution(executionId)),
        ).then(({ rows }) => {
          if (rows.length === 0) {
            return undefined;
          }
          // camel case is not working when selecting from db.
          const result = rows[0] as
            & WorkflowExecution<TArgs, TResult, TMetadata>
            & { completedat: Date };
          const { completedat: _ignore, ...rest } = {
            ...result,
            completedAt: result?.completedat,
          };
          return rest;
        }),
      create: async (execution: WorkflowExecution) => {
        await useClient(queryObject(insertExecution(executionId, execution)));
      },
      update: async (execution: WorkflowExecution) => {
        await useClient(queryObject(updateExecution(executionId, execution)));
      },
      withinTransaction: async <TResult>(
        exec: (db: Execution) => Promise<TResult>,
      ): Promise<TResult> => {
        return await useClient(async (client) => {
          await client.query("BEGIN");
          await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          try {
            const execDB = executionsFor(apply(client));
            const result = await exec(execDB(executionId));
            await client.query("COMMIT");
            return result;
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          }
        });
      },
    };
  };

function dbFor(useClient: UseClient): DB {
  return {
    execution: executionsFor(useClient),
    pendingExecutions: (
      lockTimeoutMS: number,
      limit: number,
    ): Promise<PendingExecution[]> => {
      return useClient(
        queryObject<{ id: string }>(pendingExecutions(lockTimeoutMS, limit)),
      ).then(({ rows }) =>
        rows.map(({ id: execution }: { id: string }) => ({
          execution,
          unlock: unlockWkflowExecution(execution),
        }))
      );
    },
  };
}

export const postgres = async () => {
  await usePool(queryObject(schema)); // creating db schema.
  return dbFor(usePool);
};
