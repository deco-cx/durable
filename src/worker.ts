import { Hono } from "hono";
import { getRouter } from "../api/router.ts";
import { dbForEnv } from "../backends/durableObjects/connect.ts";
import { buildWorkflowRegistry } from "../registry/registries.ts";
import { setFromString } from "../security/keys.ts";
export { Workflow } from "./workflow.ts";

export interface Env {
  WORKFLOWS: DurableObjectNamespace;
  EXECUTIONS: AnalyticsEngineDataset;
  WORKER_PUBLIC_KEY: string;
  WORKER_PRIVATE_KEY: string;
}

const registry = await buildWorkflowRegistry();
export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    setFromString(env.WORKER_PUBLIC_KEY, env.WORKER_PRIVATE_KEY);
    const db = dbForEnv({ env, signal: req.signal });
    const router = await getRouter(new Hono(), db, registry);
    return router.fetch(req, env, ctx);
  },
};
