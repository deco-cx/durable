import { Execution } from "../../../backends/backend.ts";
import { durableExecution } from "../../../backends/durableObjects/db.ts";
import { PromiseOrValue } from "../../../promise.ts";
import { buildWorkflowRegistry } from "../../../registry/registries.ts";
import { HistoryEvent } from "../../../runtime/core/events.ts";
import { runWorkflow } from "../../../workers/main.ts";
import { Env } from "./worker.ts";

export type DurableObjectState = any;
export type Handler = (request: Request) => PromiseOrValue<Response>;
export type HTTPMethod = "GET" | "POST" | "PUT" | "HEAD" | "DELETE";
export type Routes = Record<
  string,
  Partial<Record<HTTPMethod, Handler>> | Handler
>;

export const buildRoutes = (wkflow: Workflow): Routes => {
  return {
    "/": {},
    "/pending": {},
    "/history": {},
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
  handler: (...events: HistoryEvent[]) => Promise<void>;
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
      this.handler = (...newEvents: HistoryEvent[]) => {
        return runWorkflow(
          durableExecution(this.state.storage, newEvents),
          registry,
        );
      };
    });
  }

  async alarm() {
    await this.handler();
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    return await this.router(request);
  }
}
