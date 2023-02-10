import {
  PoolClient,
  Transaction,
} from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import {
  QueryArguments,
  QueryObjectResult,
} from "https://deno.land/x/postgres@v0.17.0/query/query.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import { DEBUG_ENABLED } from "../../mod.ts";
import { apply } from "../../utils.ts";
import {
  DB,
  Events,
  Execution,
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
    get: async () => {
      const events = await useClient(queryObject<PersistedEvent>(eventsQuery));
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
        ).then(({ rows }) => (rows.length === 0 ? undefined : rows[0])),
      create: async (execution: WorkflowExecution) => {
        await useClient(queryObject(insertExecution(executionId, execution)));
      },
      update: async (execution: WorkflowExecution) => {
        await useClient(queryObject(updateExecution(executionId, execution)));
      },
    };
  };

function dbFor(useClient: UseClient): DB {
  return {
    execution: executionsFor(useClient),
    withinTransaction: async <TResult>(
      exec: (db: DB) => Promise<TResult>,
    ): Promise<TResult> => {
      return await useClient(async (client) => {
        if (!isClient(client)) {
          return await exec(dbFor(apply(client)));
        }
        const transaction = client.createTransaction("transaction", {
          isolation_level: "repeatable_read",
        });
        await transaction.begin();
        try {
          const result = await exec(dbFor(apply(transaction)));
          await transaction.commit();
          return result;
        } catch (e) {
          await transaction.rollback();
          throw e;
        }
      });
    },
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

await usePool(queryObject(schema)); // creating db schema.

export const postgres = () => dbFor(usePool);
