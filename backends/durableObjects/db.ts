import { PromiseOrValue } from "../../promise.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import {
  DB,
  Execution,
  PaginationParams,
  WorkflowExecution,
} from "../backend.ts";

export interface SingletonStorage<T> {
  get: () => Promise<T | undefined>;
  put: (value: T) => Promise<void>;
}

export interface Identifiable {
  id: string;
}
export interface CollectionStorage<T extends readonly Identifiable[]> {
  add: (...items: T) => Promise<void>;
  get: (
    pagination?: PaginationParams & { reverse?: boolean },
  ) => Promise<Map<string, T[number]>>;
  del: (...items: T) => Promise<void>;
}
export const useSingleton = <T>(
  key: string,
  durable: DurableObjectTransaction | DurableObjectStorage,
): SingletonStorage<T> => {
  return {
    get: () => durable.get(key),
    put: (value: T) => durable.put(key, value),
  };
};

export const useCollection = <T extends readonly Identifiable[]>(
  prefix: string,
  durable: DurableObjectTransaction | DurableObjectStorage,
): CollectionStorage<T> => {
  const itemId = (item: Identifiable) => `${prefix}-${item.id}`;
  return {
    add: async (...items: T): Promise<void> => {
      await Promise.all(
        items.map((item) => durable.put(itemId(item), item)),
      );
    },
    get: async (
      pagination?: PaginationParams & { reverse?: boolean },
    ): Promise<Map<string, T[number]>> => {
      const items = await durable.list<T[number]>({
        prefix,
        reverse: pagination?.reverse ?? false,
      });
      if (!pagination) {
        return items;
      }

      // TODO(mcandeia) add pagination
      const page = pagination?.page ?? 0;
      const pageSize = pagination?.pageSize ?? 10;
      const start = page * pageSize;
      const end = start + pageSize;
      return items;
    },
    del: async (...items: T): Promise<void> => {
      await durable.delete(items.map(itemId));
    },
  };
};

const Keys = {
  execution: "execution",
  history: "history",
  pending: "pending",
};
const sortHistoryEventByDate = (
  a: HistoryEvent,
  b: HistoryEvent,
) => a.timestamp.getTime() - b.timestamp.getTime();

export const durableExecution = (
  db: DurableObjectTransaction | DurableObjectStorage,
  transientEvents?: HistoryEvent[],
) => {
  const executions = useSingleton<WorkflowExecution>(
    Keys.execution,
    db,
  );
  const pending = useCollection<HistoryEvent[]>(Keys.pending, db);
  const history = useCollection<HistoryEvent[]>(Keys.history, db);
  return {
    get: executions.get.bind(executions),
    create: executions.put.bind(executions),
    update: executions.put.bind(executions),
    pending: {
      get: async () => {
        const evts = await pending.get();
        return [...transientEvents ?? [], ...evts.values()].sort(
          sortHistoryEventByDate,
        );
      },
      add: async (...events: HistoryEvent[]) => {
        // set current alarm if the any event should occur before the current alarm.
        const initialCurrentAlarm: number | null = await db.getAlarm();
        let currentAlarm = initialCurrentAlarm;
        for (const event of events) {
          event.visibleAt = event.visibleAt
            ? new Date(event.visibleAt)
            : event.visibleAt;
          if (
            event.visibleAt &&
            (currentAlarm === null || event.visibleAt.getTime() < currentAlarm)
          ) {
            currentAlarm = event.visibleAt.getTime();
          }
        }
        const promises: Promise<void>[] = [pending.add(...events)];
        if (initialCurrentAlarm !== currentAlarm && currentAlarm) {
          promises.push(db.setAlarm(currentAlarm));
        }
        await Promise.all(promises);
      },
      del: async (...events: HistoryEvent[]) => {
        const keys = events.map((event) => event.id);
        const beingDeleted: Record<string, boolean> = keys.reduce(
          (acc, key) => {
            acc[key] = true;
            return acc;
          },
          {} as Record<string, boolean>,
        );
        const deletePromise = pending.del(...events);
        const [current, initialCurrentAlarm] = await Promise.all([
          pending.get(),
          db.getAlarm(),
        ]);

        let currentAlarm = initialCurrentAlarm;

        for (const [key, event] of Object.entries(current)) {
          if (!beingDeleted[key]) { // not being deleted
            event.visibleAt = event.visibleAt
              ? new Date(event.visibleAt)
              : event.visibleAt;
            if (
              event.visibleAt &&
              (
                currentAlarm === null ||
                event.visibleAt.getTime() < currentAlarm
              )
            ) {
              currentAlarm = event.visibleAt.getTime();
            }
          }
        }
        const promises: Promise<void>[] = [deletePromise];
        if (initialCurrentAlarm !== currentAlarm && currentAlarm) {
          promises.push(db.setAlarm(currentAlarm));
        }

        await Promise.all(promises);
      },
    },
    history: {
      ...history,
      get: async (pagination?: PaginationParams) => {
        const reverse = pagination !== undefined;
        const hist = await history.get({ ...(pagination ?? {}), reverse });
        return [...hist.values()].sort((a, b) => {
          const resp = a.seq - b.seq;
          return reverse ? -resp : resp;
        });
      },
      del: async () => {}, // del is not supported on history
    },
    withinTransaction: async <T>(
      f: (transactionalDb: Execution) => PromiseOrValue<T>,
    ): Promise<T> => {
      if (!isDurableObjStorage(db)) {
        throw new Error("cannot create inner transactions");
      }
      return (await db.transaction(
        async (inner: DurableObjectTransaction) => {
          return await f(durableExecution(inner, transientEvents));
        },
      )) as T;
    },
  };
};

const isDurableObjStorage = (
  db: DurableObjectTransaction | DurableObjectStorage,
): db is DurableObjectStorage => {
  return typeof (db as DurableObjectStorage)?.transaction === "function";
};

export const dbFor = (
  db: DurableObjectTransaction | DurableObjectStorage,
  transientEvents?: HistoryEvent[],
): DB => {
  return {
    execution: (_executionId: string) => {
      return durableExecution(db, transientEvents);
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
