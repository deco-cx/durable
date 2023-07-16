import Emittery from "emittery";
import {
  Execution,
  PaginationParams,
  WorkflowExecution,
} from "../backends/backend.ts";
import { durableExecution } from "../backends/durableObjects/db.ts";
import { PromiseOrValue } from "../promise.ts";
import { buildWorkflowRegistry } from "../registry/registries.ts";
import { HistoryEvent } from "../runtime/core/events.ts";
import { runWorkflow } from "../runtime/core/workflow.ts";
import { secondsFromNow } from "../utils.ts";
import { Env } from "./worker.ts";

const MAX_RETRY_COUNT = 10;

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
        await wkflow.execution.pending.add(...body.events);
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
            await writer.write(encoder.encode(JSON.stringify(currentHistory)));
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
                writer.close();
                return;
              }
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

  constructor(state: DurableObjectState, _env: Env) {
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
  async addRetries() {
    let currentRetries = await this.state.storage.get<number>("retries") ?? 0;
    await this.state.storage.put("retries", ++currentRetries);
    return currentRetries;
  }
  async zeroRetries() {
    await this.state.storage.put("retries", 0);
  }
  async onAlarmError(err: any) {
    try {
      console.error("alarm error", JSON.stringify(err));
    } catch {}
    const retryCount = await this.addRetries();
    if (retryCount >= MAX_RETRY_COUNT) {
      console.log(
        `workflow ${(await this.execution.get())
          ?.id} has reached a maximum retry count of ${MAX_RETRY_COUNT}`,
      );
      await this.zeroRetries();
      return; // returning OK so the alarm will not be retried
    }
    await this.state.storage.setAlarm(secondsFromNow(15));
  }
  async onAlarmSuccess() {
    await this.zeroRetries();
  }

  async history(pagination?: PaginationParams) {
    return await this.execution.withGateOpts({ allowConcurrency: true }).history
      .get(pagination);
  }

  async alarm() {
    await this.handler().then(this.onAlarmSuccess).catch(this.onAlarmError);
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    return await this.router(request);
  }
}
