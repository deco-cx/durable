import type { Pagination } from "../api/service.ts";
import type {
  PaginationParams,
  WorkflowExecution,
} from "../backends/backend.ts";
import type { HistoryEvent } from "../runtime/core/events.ts";

export interface ClientOptions {
  token?: string;
  durableEndpoint?: string;
  namespace?: string;
}
let defaultOpts: ClientOptions | null = null;
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
        authorization: `Bearer ${token}`,
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

export const start = async (
  exec: Omit<WorkflowExecution, "id"> | WorkflowExecution,
  opts?: ClientOptions,
): Promise<WorkflowExecution> => {
  return fetchJSON<WorkflowExecution>(`/executions`, opts, {
    body: JSON.stringify(exec),
    method: "POST",
  });
};

export const history = async (
  id: string,
  pagination?: PaginationParams & { stream?: boolean },
  opts?: ClientOptions,
): Promise<
  Pagination<HistoryEvent[]> | AsyncIterableIterator<HistoryEvent>
> => {
  if (pagination?.stream) {
    const response = await fetchSuccessResponse(
      `/executions/${id}/history?stream=true`,
      opts,
    );
    return readFromStream<HistoryEvent>(response);
  }

  return fetchJSON<Pagination<HistoryEvent[]>>(
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

export const get = async (
  id: string,
  opts?: ClientOptions,
): Promise<WorkflowExecution | null> => {
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
  return response.json<WorkflowExecution>();
};

export const cancel = async (
  id: string,
  opts?: ClientOptions,
): Promise<void> => {
  await fetchSuccessResponse(`/executions/${id}`, opts, { method: "DELETE" });
};
