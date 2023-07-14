export interface SingletonStorage<T> {
  get: () => Promise<T | undefined>;
  put: (value: T) => Promise<void>;
}

export interface Identifiable {
  id: string;
}
export interface CollectionStorage<T extends readonly Identifiable[]> {
  add: (...items: T) => Promise<void>;
  get: () => Promise<T[number][]>;
}
export const useSingleton = <T>(
  key: string,
  durable: DurableObjectTransaction | DurableObjectStorage,
): SingletonStorage<T> => {
  return {
    get: () => durable.get<T>(key),
    put: (value: T) => durable.put(key, value),
  };
};

export const useCollection = <T extends readonly Identifiable[]>(
  prefix: string,
  durable: DurableObjectTransaction | DurableObjectStorage,
): CollectionStorage<T> => {
  return {
    add: async (...items: T): Promise<void> => {
      await Promise.all(
        items.map((item) => durable.put(`${prefix}-${item.id}`, item)),
      );
    },
    get: async (): Promise<T[number][]> => {
      return Object.values(await durable.list({ prefix }));
    },
  };
};
