import {
  PoolClient,
  Transaction,
} from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import {
  QueryArguments,
  QueryObjectResult,
} from "https://deno.land/x/postgres@v0.17.0/query/query.ts";
import { DEBUG_ENABLED } from "../../mod.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
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
  f: (client: Transaction | PoolClient) => Promise<TResult>,
) => Promise<TResult>;

const isClient = (client: Transaction | PoolClient): client is PoolClient => {
  return typeof (client as PoolClient).createTransaction === "function";
};

const unlockWkflowExecution = (executionId: string) => async () => {
  await usePool((client) => {
    client.queryObject(unlockExecution(executionId));
  });
};

// TODO use queryarguments to avoid sql injection
const queryObject =
  <T>(query: string, queryArguments?: QueryArguments) =>
  (client: Transaction | PoolClient): Promise<QueryObjectResult<T>> => {
    if (DEBUG_ENABLED) {
      console.log(query);
    }
    return client.queryObject<T>(query, queryArguments);
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
      get: () =>
        useClient(
          queryObject<WorkflowExecution>(getExecution(executionId)),
        ).then(({ rows }) => {
          if (rows.length === 0) {
            return undefined;
          }
          // camel case is not working when selecting from db.
          const result = rows[0] as WorkflowExecution & { completedat: Date };
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
          if (!isClient(client)) {
            const execDB = executionsFor(apply(client));
            return await exec(execDB(executionId));
          }
          const transaction = client.createTransaction("transaction", {
            isolation_level: "repeatable_read",
          });
          await transaction.begin();
          try {
            const execDB = executionsFor(apply(transaction));
            const result = await exec(execDB(executionId));
            await transaction.commit();
            return result;
          } catch (e) {
            await transaction.rollback();
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
        rows.map(({ id: execution }) => ({
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
