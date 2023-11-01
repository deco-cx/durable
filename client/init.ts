import type { Pagination } from "../api/service.ts";
import type {
  PaginationParams,
  WorkflowExecution,
  WorkflowExecutionBase,
} from "../backends/backend.ts";
import { Metadata } from "../context.ts";
import { PromiseOrValue } from "../promise.ts";
import type { HistoryEvent } from "../runtime/core/events.ts";
import { Arg } from "../types.ts";

export interface ClientOptions {
  token?: string | (() => PromiseOrValue<string>);
  durableEndpoint?: string;
  namespace?: string;
  publicKey?: string;
  audience?: string;
}
export let defaultOpts: ClientOptions | null = null;
export const init = (opts: ClientOptions) => {
  defaultOpts = opts;
};

async function* readFromStream<T>(
  response: Response,
): AsyncIterableIterator<T> {
  if (!response.body) {
    return;
  }
  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .getReader();

  while (true) {
    let acc = "";
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    const parsedValue = value
      .split("\n")
      .filter(Boolean);

    for (const chnks of parsedValue) {
      acc += chnks;
      try {
        yield JSON.parse(acc);
      } catch {
        continue;
      }
      acc = "";
    }
  }
}

function assertInitialized(
  opts?: ClientOptions | null,
): asserts opts is ClientOptions {
  if (!opts) {
    throw new Error("client option either not initialized or provided");
  }
}

const useToken = async (token: ClientOptions["token"]) => {
  if (!token) {
    return undefined;
  }
  if (typeof token === "string") {
    return token;
  }
  return await token();
};
const fetchResponse = async (
  path: string,
  opts?: ClientOptions,
  init?: RequestInit,
): Promise<Response> => {
  const options = opts ?? defaultOpts;
  assertInitialized(options);
  const { token, namespace, durableEndpoint } = options;
  const response = await fetch(
    `${durableEndpoint}/namespaces/${namespace}${path}`,
    {
      ...init ?? {},
      headers: {
        authorization: `Bearer ${await useToken(token)}`,
      },
    },
  );
  return response;
};

const fetchSuccessResponse = async (
  path: string,
  opts?: ClientOptions,
  init?: RequestInit,
): Promise<Response> => {
  const response = await fetchResponse(path, opts, init);
  if (!response.ok) {
    throw new Error(`error was thrown from durable ${response.status}`);
  }
  return response;
};
const fetchJSON = async <T>(
  path: string,
  opts?: ClientOptions,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetchSuccessResponse(path, opts, init);
  return response.json<T>();
};

export const start = async <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
>(
  exec: WorkflowExecutionBase,
  restart?: boolean,
  opts?: ClientOptions,
): Promise<WorkflowExecution<TArgs, TResult, TMetadata>> => {
  return await fetchJSON<WorkflowExecution<TArgs, TResult, TMetadata>>(
    `/executions${restart ? "?restart" : ""}`,
    opts,
    {
      body: JSON.stringify(exec),
      method: "POST",
    },
  );
};

export const history = async (
  id: string,
  pagination?: PaginationParams & { stream?: boolean },
  opts?: ClientOptions,
): Promise<
  Pagination<HistoryEvent> | AsyncIterableIterator<HistoryEvent>
> => {
  if (pagination?.stream) {
    const response = await fetchSuccessResponse(
      `/executions/${id}/history?stream=true`,
      opts,
    );
    return readFromStream<HistoryEvent>(response);
  }

  return fetchJSON<Pagination<HistoryEvent>>(
    `/executions/${id}/history?${
      pagination
        ? `page=${pagination?.page ?? 0}&pageSize=${pagination?.pageSize ?? 50}`
        : ""
    }`,
    opts,
  );
};

export const signal = async (
  id: string,
  event: string,
  payload: unknown,
  opts?: ClientOptions,
) => {
  await fetchSuccessResponse(
    `/executions/${id}/signals/${event}`,
    opts,
    {
      method: "POST",
      body: payload ? JSON.stringify(payload) : undefined,
    },
  );
};

export const get = async <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
>(
  id: string,
  opts?: ClientOptions,
): Promise<WorkflowExecution<TArgs, TResult, TMetadata> | null> => {
  const response = await fetchResponse(
    `/executions/${id}`,
    opts,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`error was thrown from durable ${response.status}`);
  }
  return response.json<WorkflowExecution<TArgs, TResult, TMetadata>>();
};

export const cancel = async (
  id: string,
  reason?: string,
  opts?: ClientOptions,
): Promise<void> => {
  await fetchSuccessResponse(`/executions/${id}`, opts, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
};
