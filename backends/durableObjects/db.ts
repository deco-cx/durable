import { PromiseOrValue } from "../../promise.ts";
import { HistoryEvent } from "../../runtime/core/events.ts";
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
export const sortHistoryEventByDate = (
  fst: HistoryEvent,
  snd: HistoryEvent,
) => {
  if (fst.visibleAt === undefined && snd.visibleAt === undefined) {
    return new Date(fst.timestamp).getTime() -
      new Date(snd.timestamp).getTime();
  }
  if (fst.visibleAt === undefined) {
    return -1;
  }
  if (snd.visibleAt === undefined) {
    return 1;
  }
  return new Date(fst.timestamp).getTime() - new Date(snd.timestamp).getTime();
};

export const durableExecution = (
  db: DurableObjectTransaction | DurableObjectStorage,
  gateOpts: GateOptions = { allowUnconfirmed: false },
) => {
  const executions = useSingleton<WorkflowExecution<any, any, any>>(
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
    withGateOpts: (gateOpts: GateOptions) => durableExecution(db, gateOpts),
    get: executions.get.bind(executions),
    create: executions.put.bind(executions),
    update: executions.put.bind(executions),
    pending: {
      ...pending,
      get: async (pagination?: PaginationParams) => {
        const items = await pending.get(pagination);
        return Array.from(items.values());
      },
    },
    history: {
      ...history,
      get: async (pagination?: PaginationParams) => {
        const reverse =
          (pagination?.page ?? pagination?.pageSize) !== undefined;
        const hist = await history.get({ ...(pagination ?? {}), reverse });
        const values = Array.from(hist.values()).sort((histA, histB) => {
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
      return await f(durableExecution(db, gateOpts));
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
      );
    },
    pendingExecutions: () => {
      return Promise.resolve([]);
    },
  };
};
