import Emittery from "emittery";
import { PaginationParams, WorkflowExecution } from "../backends/backend.ts";
import { durableExecution } from "../backends/durableObjects/db.ts";
import { PromiseOrValue } from "../promise.ts";
import { buildWorkflowRegistry } from "../registry/registries.ts";
import { HistoryEvent } from "../runtime/core/events.ts";
import { runWorkflow } from "../runtime/core/workflow.ts";
import { setFromString } from "../security/keys.ts";
import { secondsFromNow } from "../utils.ts";
import { Env } from "./worker.ts";

const MAX_RETRY_COUNT = 20;
const MAXIMUM_BACKOFF_SECONDS = 64;

export type Handler = (request: Request) => PromiseOrValue<Response>;
export type HTTPMethod = "GET" | "POST" | "PUT" | "HEAD" | "DELETE";
export type Routes = Record<
  string,
  Partial<Record<HTTPMethod, Handler>> | Handler
>;

export const buildRoutes = (wkflow: Workflow): Routes => {
  return {
    "/": {
      "GET": async (_req: Request) => {
        return Response.json(await wkflow.execution.get());
      },
      "POST": async (req: Request) => {
        const body = await req.json();
        await wkflow.execution.create(body as WorkflowExecution);
        return new Response(JSON.stringify(body), { status: 201 });
      },
    },
    "/pending": {
      "POST": async (req: Request) => {
        const body: { events: HistoryEvent[] } = await req.json();
        await Promise.all([
          wkflow.execution.pending.add(...body.events),
          wkflow.state.storage.setAlarm(secondsFromNow(15)), // we set as a safety guard to make sure that the workflow will execute in a at-least-once fashion
        ]);
        wkflow.state.waitUntil(wkflow.handler(true));
        return new Response(JSON.stringify({}), { status: 200 });
      },
      "GET": async (_req: Request) => {
        const search = new URL(_req.url).searchParams;
        let pagination = undefined;
        if (search.has("page")) {
          pagination = { page: +search.get("page")! };
        }
        if (search.has("pageSize")) {
          pagination = {
            ...(pagination ?? {}),
            pageSize: +search.get("pageSize")!,
          };
        }

        return new Response(
          JSON.stringify(
            await wkflow.execution.pending.get(
              pagination ?? { page: 0, pageSize: 10 },
            ),
          ),
          { status: 200 },
        );
      },
    },
    "/history": {
      "GET": async (_req: Request) => {
        const search = new URL(_req.url).searchParams;
        if (search.has("stream")) {
          const eventStream = wkflow.historyStream.anyEvent();

          if (!eventStream) {
            return new Response(null, { status: 204 });
          }
          _req.signal.onabort = () => {
            eventStream.return?.();
          };
          const { readable, writable } = new TransformStream();
          (async () => {
            const encoder = new TextEncoder();
            const [currentHistory, isCompleted] = await Promise.all([
              wkflow.history(),
              wkflow.isCompleted(),
            ]);
            const writer = writable.getWriter();
            try {
              await writer.write(
                encoder.encode(JSON.stringify(currentHistory)),
              );
              if (
                isCompleted
              ) {
                return;
              }
              let sentEvents: Record<string, boolean> = {};

              for (const event of currentHistory) {
                sentEvents[event.id] = true;
              }
              const withoutSentEvents = (event: HistoryEvent): boolean => {
                const sent = sentEvents[event.id];
                sentEvents[event.id] = true;
                return !sent;
              };

              for await (const events of eventStream) {
                await writer.write(
                  encoder.encode(
                    JSON.stringify(events[1].filter(withoutSentEvents)),
                  ),
                );
                if (await wkflow.isCompleted()) {
                  return;
                }
              }
            } finally {
              try {
                await writer.close();
              } catch {}
            }
          })();
          return new Response(readable, {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "connection": "keep-alive",
              "cache-control": "no-cache",
            },
          });
        }
        let pagination = undefined;
        if (search.has("page")) {
          pagination = { page: +search.get("page")! };
        }
        if (search.has("pageSize")) {
          pagination = {
            ...(pagination ?? {}),
            pageSize: +search.get("pageSize")!,
          };
        }
        return new Response(
          JSON.stringify(
            await wkflow.history(
              pagination ?? { page: 0, pageSize: 10 },
            ),
          ),
          { status: 200 },
        );
      },
    },
  };
};

export const router = (routes: Routes): Handler => {
  return (req: Request): PromiseOrValue<Response> => {
    const url = new URL(req.url);
    const handlerOrRouter = routes[url.pathname];
    if (!handlerOrRouter) {
      return new Response(null, { status: 404 });
    }
    if (typeof handlerOrRouter === "function") {
      return handlerOrRouter(req);
    }
    const methodHandler = handlerOrRouter[req.method as HTTPMethod];
    if (!methodHandler) {
      return new Response(null, { status: 405 });
    }
    return methodHandler(req);
  };
};

export class Workflow {
  state: DurableObjectState;
  execution: ReturnType<typeof durableExecution>;
  handler: (allowUnconfirmed?: boolean) => Promise<void>;
  router: Handler;
  historyStream: Emittery<{ "history": HistoryEvent[] }>;

  constructor(state: DurableObjectState, env: Env) {
    setFromString(env.WORKER_PUBLIC_KEY, env.WORKER_PRIVATE_KEY);
    this.state = state;
    this.historyStream = new Emittery<{ "history": HistoryEvent[] }>();
    this.handler = async () => {};
    this.execution = durableExecution(this.state.storage, this.historyStream);
    this.router = router(buildRoutes(this));
    this.state.blockConcurrencyWhile(async () => {
      const [registry] = await Promise.all([
        buildWorkflowRegistry(),
      ]);
      // After initialization, future reads do not need to access storage.
      this.handler = (allowUnconfirmed = false) => {
        return runWorkflow(
          durableExecution(
            this.state.storage,
            this.historyStream,
            { allowUnconfirmed },
          ),
          registry,
        ).then(this.onHandleSuccess(allowUnconfirmed)).catch(
          this.onHandleError(allowUnconfirmed),
        );
      };
    });
  }
  async isCompleted() {
    const execution = await this.execution.withGateOpts({
      allowConcurrency: true,
    }).get();

    return execution?.status === "completed" ||
      execution?.status === "canceled";
  }
  async addRetries(allowUnconfirmed = false) {
    let currentRetries = await this.state.storage.get<number>("retries") ?? 0;
    await this.state.storage.put("retries", ++currentRetries, {
      allowUnconfirmed,
    });
    return currentRetries;
  }
  async zeroRetries(allowUnconfirmed = false) {
    await this.state.storage.put("retries", 0, { allowUnconfirmed });
  }
  onHandleError(allowUnconfirmed = false) {
    return async (err: any) => {
      const retryCount = await this.addRetries(allowUnconfirmed);
      if (retryCount >= MAX_RETRY_COUNT) {
        console.log(
          `workflow ${(await this.execution.withGateOpts({ allowUnconfirmed })
            .get())
            ?.id} has reached a maximum retry count of ${MAX_RETRY_COUNT}`,
        );
        await this.zeroRetries(allowUnconfirmed);
        return; // returning OK so the alarm will not be retried
      }
      const jitter = (Math.floor(Math.random() * 2)) + 1; // from 1 to 3s of jitter
      const inSeconds = Math.min(
        (2 ^ retryCount) + jitter,
        MAXIMUM_BACKOFF_SECONDS,
      );
      try {
        console.error(
          `handle error retry count ${retryCount}, trying in ${inSeconds} seconds`,
          JSON.stringify(err),
        );
      } catch {}
      await this.state.storage.setAlarm(secondsFromNow(inSeconds), {
        allowUnconfirmed,
      });
    };
  }
  onHandleSuccess(allowUnconfirmed = false) {
    return async () => {
      await this.zeroRetries(allowUnconfirmed);
    };
  }

  async history(pagination?: PaginationParams) {
    return await this.execution.withGateOpts({ allowConcurrency: true }).history
      .get(pagination);
  }

  async alarm() {
    const executionPromise = this.execution.withGateOpts({
      allowConcurrency: true,
    }).get();
    try {
      await this.handler();
    } finally {
      console.log(`alarm for execution ${(await executionPromise)?.id}`);
    }
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    return await this.router(request);
  }
}
