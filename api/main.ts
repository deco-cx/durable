import { Hono } from "https://deno.land/x/hono@v3.2.7/mod.ts";
import { DB } from "../backends/backend.ts";
import { postgres } from "../backends/postgres/db.ts";
import { WorkflowRegistry } from "../registry/registries.ts";
import { getRouter } from "./router.ts";

// as alias is immutable we can cache it forever.
export const start = async (db?: DB, _registry?: WorkflowRegistry) => {
  const app = new Hono();
  const router = await getRouter(app, db ?? await postgres(), _registry);
  Deno.serve({ port: 8001, hostname: "0.0.0.0" }, router.fetch);
};

if (import.meta.main) {
  await start();
}
