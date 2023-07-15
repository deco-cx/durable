import { Execution, WorkflowExecution } from "../backends/backend.ts";
import { durableExecution } from "../backends/durableObjects/db.ts";
import { PromiseOrValue } from "../promise.ts";
import { buildWorkflowRegistry } from "../registry/registries.ts";
import { HistoryEvent } from "../runtime/core/events.ts";
import { secondsFromNow } from "../utils.ts";
import { runWorkflow } from "../workers/run.ts";
import { Env } from "./worker.ts";

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
            await wkflow.execution.history.get(
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
  execution: Execution;
  handler: (allowUnconfirmed?: boolean) => Promise<void>;
  router: Handler;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.handler = async () => {};
    this.execution = durableExecution(this.state.storage);
    this.router = router(buildRoutes(this));
    this.state.blockConcurrencyWhile(async () => {
      const [registry] = await Promise.all([
        buildWorkflowRegistry(),
      ]);
      // After initialization, future reads do not need to access storage.
      this.handler = (allowUnconfirmed = false) => {
        return runWorkflow(
          durableExecution(this.state.storage, allowUnconfirmed),
          registry,
        );
      };
    });
  }

  async alarm() {
    await this.handler().catch(async (err) => {
      console.error("alarm error", err);
      await this.state.storage.setAlarm(secondsFromNow(15));
    });
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    return await this.router(request);
  }
}
