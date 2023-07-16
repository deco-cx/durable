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
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const db = dbForEnv({ env, signal: req.signal });
    const router = await getRouter(new Hono(), db, registry);
    return router.fetch(req, env, ctx);
  },
};
