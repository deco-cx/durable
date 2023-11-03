import { WorkflowService } from "../api/service.ts";
import { PaginationParams, WorkflowExecution } from "../backends/backend.ts";
import { dbForEnv } from "../backends/durableObjects/connect.ts";
import {
  durableExecution,
  sortHistoryEventByDate,
} from "../backends/durableObjects/db.ts";
import { PromiseOrValue } from "../promise.ts";
import { HistoryEvent } from "../runtime/core/events.ts";
import { runWorkflow } from "../runtime/core/workflow.ts";
import { newJwtIssuer } from "../security/jwt.ts";
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
        const result = await wkflow.execution.get();
        if (!result) {
          return new Response(null, { status: 404 });
        }
        return Response.json(result);
      },
      "POST": async (req: Request) => {
        const body: WorkflowExecution = await req.json();
        const shouldRestart = new URL(req.url).searchParams.has("restart");
        const deleteAlarmPromise = shouldRestart
          ? wkflow.state.storage.deleteAlarm()
          : Promise.resolve();
        const pendingAndHistory = shouldRestart
          ? Promise.all([
            wkflow.execution.pending.get(),
            wkflow.execution.history.get(),
          ])
          : Promise.resolve([[], []]);
        const createPromise = wkflow.execution.create(body);
        const [pending, history] = await pendingAndHistory;
        await Promise.all([
          wkflow.execution.pending.del(...pending),
          wkflow.execution.history.del(...history),
          createPromise,
          deleteAlarmPromise,
        ]);
        wkflow.workflowExecution = body;
        return new Response(JSON.stringify(body), { status: 201 });
      },
    },
    "/pending": {
      "POST": async (req: Request) => {
        const body: { events: HistoryEvent[] } = await req.json();
        await Promise.all([
          wkflow.execution.pending.add(...body.events),
          wkflow.scheduleRetry(), // we set as a safety guard to make sure that the workflow will execute in a at-least-once fashion
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
          const sentEvents: Record<string, boolean> = {};
          const eventStream = (async function* () {
            while (true) {
              if (_req.signal.aborted) {
                break;
              }
              const [currentHistory, isCompleted] = await Promise.all([
                wkflow.history(),
                wkflow.isCompleted(),
              ]);
              for (const event of currentHistory) {
                const sent = sentEvents[event.id];
                sentEvents[event.id] = true;
                if (!sent) {
                  yield event;
                }
              }
              if (isCompleted) {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          })();

          const { readable, writable } = new TransformStream();
          (async () => {
            const encoder = new TextEncoder();
            const writer = writable.getWriter();
            try {
              for await (const event of eventStream) {
                await writer.write(
                  encoder.encode(
                    JSON.stringify(event),
                  ),
                );
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
  workflowExecution: WorkflowExecution | undefined;

  constructor(state: DurableObjectState, protected env: Env) {
    setFromString(env.WORKER_PUBLIC_KEY, env.WORKER_PRIVATE_KEY);
    this.state = state;
    this.handler = async () => {};
    this.execution = durableExecution(this.state.storage);
    this.router = router(buildRoutes(this));
    this.state.blockConcurrencyWhile(async () => {
      const issuerPromise = newJwtIssuer({
        private: env.WORKER_PRIVATE_KEY,
        public: env.WORKER_PUBLIC_KEY,
      });
      this.workflowExecution = await this.execution.get();
      const durableConnection = new WorkflowService(
        dbForEnv({ env }),
        await issuerPromise,
      );

      // After initialization, future reads do not need to access storage.
      this.handler = (allowUnconfirmed = false) => {
        return runWorkflow(
          durableExecution(
            this.state.storage,
            { allowUnconfirmed },
          ),
          durableConnection,
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
      this.env.EXECUTIONS?.writeDataPoint({
        blobs: [
          (err as Error).message ?? "no_msg",
          this.workflowExecution!.workflow.url,
          "error",
        ],
        doubles: [retryCount],
        indexes: [
          `${this.workflowExecution!.namespace}@${this.workflowExecution!.id}`,
        ],
      });

      if (retryCount >= MAX_RETRY_COUNT) {
        console.log(
          `workflow ${
            this.workflowExecution!.id
          } has reached a maximum retry count of ${MAX_RETRY_COUNT}`,
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

  async scheduleRetry(allowUnconfirmed = false) {
    await this.state.storage.setAlarm(secondsFromNow(15), {
      allowUnconfirmed,
    });
  }
  onHandleSuccess(allowUnconfirmed = false) {
    return async () => {
      const [pending, isCompleted, _] = await Promise.all([
        this.execution.withGateOpts({ allowUnconfirmed })
          .pending
          .get(),
        this.isCompleted(),
        this.zeroRetries(allowUnconfirmed),
      ]);
      this.env.EXECUTIONS?.writeDataPoint({
        blobs: [
          `${isCompleted}`,
          this.workflowExecution!.workflow.url,
          "success",
        ],
        doubles: [0],
        indexes: [
          `${this.workflowExecution!.namespace}@${this.workflowExecution!.id}`,
        ],
      });
      const next = pending.sort(sortHistoryEventByDate)[0];
      if (next === undefined) {
        if (!isCompleted) {
          await this.scheduleRetry(allowUnconfirmed);
        } else {
          await this.state.storage.deleteAlarm({ allowUnconfirmed });
        }
        return;
      } else if (next.visibleAt) {
        await this.state.storage.setAlarm(new Date(next.visibleAt).getTime());
      } else {
        await this.scheduleRetry(allowUnconfirmed);
      }
    };
  }

  async history(pagination?: PaginationParams) {
    return await this.execution.withGateOpts({ allowConcurrency: true }).history
      .get(pagination);
  }

  async alarm() {
    try {
      await this.handler();
    } finally {
      console.log(`alarm for execution ${this.workflowExecution?.id!}`);
    }
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    return await this.router(request);
  }
}
