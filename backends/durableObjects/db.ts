import Emittery from "emittery";
import { PromiseOrValue } from "../../promise.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
import { secondsFromNow } from "../../utils.ts";
import {
  DB,
  Execution,
  PaginationParams,
  WorkflowExecution,
} from "../backend.ts";

export interface GateOptions {
  allowUnconfirmed?: boolean;
  allowConcurrency?: boolean;
}
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
  { allowUnconfirmed }: GateOptions = { allowUnconfirmed: false },
): SingletonStorage<T> => {
  return {
    get: () => durable.get(key),
    put: (value: T) => durable.put(key, value, { allowUnconfirmed }),
  };
};

export const useCollection = <T extends readonly Identifiable[]>(
  prefix: string,
  durable: DurableObjectTransaction | DurableObjectStorage,
  { allowUnconfirmed }: GateOptions = { allowUnconfirmed: false },
): CollectionStorage<T> => {
  const itemId = (item: Identifiable) => `${prefix}-${item.id}`;
  return {
    add: async (...items: T): Promise<void> => {
      await Promise.all(
        items.map((item) => durable.put(itemId(item), item), {
          allowUnconfirmed,
        }),
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
      return items;
    },
    del: async (...items: T): Promise<void> => {
      await durable.delete(items.map(itemId), { allowUnconfirmed });
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
) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();

export const durableExecution = (
  db: DurableObjectTransaction | DurableObjectStorage,
  historyStream: Emittery<{ "history": HistoryEvent[] }>,
  gateOpts: GateOptions = { allowUnconfirmed: false },
) => {
  const executions = useSingleton<WorkflowExecution>(
    Keys.execution,
    db,
    gateOpts,
  );
  const pending = useCollection<HistoryEvent[]>(
    Keys.pending,
    db,
    gateOpts,
  );
  const history = useCollection<HistoryEvent[]>(
    Keys.history,
    db,
    gateOpts,
  );
  return {
    withGateOpts: (gateOpts: GateOptions) =>
      durableExecution(db, historyStream, gateOpts),
    get: executions.get.bind(executions),
    create: executions.put.bind(executions),
    update: executions.put.bind(executions),
    pending: {
      get: async (paginationParams?: PaginationParams) => {
        const evts = await pending.get(paginationParams);
        return [...evts.values()].sort(
          sortHistoryEventByDate,
        );
      },
      add: async (...events: HistoryEvent[]) => {
        let lessyVisibleAt: number | null = null;
        let atLeastOneShouldBeExecutedNow = false;
        for (const event of events) {
          event.visibleAt = event.visibleAt
            ? new Date(event.visibleAt)
            : event.visibleAt;

          atLeastOneShouldBeExecutedNow ||= !event.visibleAt;
          if (
            event.visibleAt &&
            (lessyVisibleAt === null ||
              event.visibleAt.getTime() < lessyVisibleAt)
          ) {
            lessyVisibleAt = event.visibleAt.getTime();
          }
        }
        const promises: Promise<void>[] = [pending.add(...events)];
        if (atLeastOneShouldBeExecutedNow) {
          promises.push(
            db.setAlarm(secondsFromNow(15), {
              allowUnconfirmed: gateOpts.allowUnconfirmed,
            }),
          );
          await Promise.all(promises);
          return;
        }

        const currentAlarm: number | null = await db.getAlarm();
        if (
          lessyVisibleAt &&
          (currentAlarm === null || currentAlarm < lessyVisibleAt)
        ) {
          promises.push(
            db.setAlarm(lessyVisibleAt, {
              allowUnconfirmed: gateOpts.allowUnconfirmed,
            }),
          );
        }
        await Promise.all(promises);
      },
      del: async (...events: HistoryEvent[]) => {
        await pending.del(...events);
        const initialCurrentAlarmPromise = db.getAlarm();

        const current = await pending.get();

        if (current.size === 0) { // no pending events
          await db.deleteAlarm({ allowUnconfirmed: gateOpts.allowUnconfirmed });
          return;
        }

        const initialCurrentAlarm = await initialCurrentAlarmPromise;
        let currentAlarm = initialCurrentAlarm;

        for (const event of current.values()) {
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
        if (
          initialCurrentAlarm !== currentAlarm && currentAlarm &&
          (!initialCurrentAlarm || currentAlarm < initialCurrentAlarm)
        ) {
          await db.setAlarm(currentAlarm, {
            allowUnconfirmed: gateOpts.allowUnconfirmed,
          });
        }
      },
    },
    history: {
      ...history,
      add: async (...events: HistoryEvent[]) => {
        return history.add(...events).then((r) => {
          historyStream.emit("history", events);
          return r;
        });
      },
      get: async (pagination?: PaginationParams) => {
        const reverse =
          (pagination?.page ?? pagination?.pageSize) !== undefined;
        const hist = await history.get({ ...(pagination ?? {}), reverse });
        const values = [...hist.values()].sort((histA, histB) => {
          const diff = histA.seq - histB.seq;
          return reverse ? -diff : diff;
        });
        if (reverse) {
          const page = pagination?.page ?? 0;
          const pageSize = pagination?.pageSize ?? 10;
          const start = page * pageSize;
          const end = start + pageSize;
          return values.slice(start, end);
        }
        return values;
      },
      del: async () => {}, // del is not supported on history
    },
    withinTransaction: async <T>(
      f: (transactionalDb: Execution) => PromiseOrValue<T>,
    ): Promise<T> => {
      if (!isDurableObjStorage(db)) {
        throw new Error("cannot create inner transactions");
      }
      return await f(durableExecution(db, historyStream, gateOpts));
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
): DB => {
  return {
    execution: (_executionId: string) => {
      return durableExecution(
        db,
        new Emittery<{ "history": HistoryEvent[] }>(),
      );
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
