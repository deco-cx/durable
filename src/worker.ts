import { Hono } from "hono";
import { getRouter } from "../api/router.ts";
import { dbForEnv } from "../backends/durableObjects/connect.ts";
import { buildWorkflowRegistry } from "../registry/registries.ts";
export { Workflow } from "./workflow.ts";

export interface Env {
  WORKFLOWS: DurableObjectNamespace;
}

const registry = await buildWorkflowRegistry();
export default {
  // Our fetch handler is invoked on a HTTP request: we can send a message to a queue
  // during (or after) a request.
  // https://developers.cloudflare.com/queues/platform/javascript-apis/#producer
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const db = dbForEnv(env);
    const router = await getRouter(new Hono(), db, registry);
    return router.fetch(req, env, ctx);
  },
};
