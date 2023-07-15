import type { Hono } from "hono";
import type { DB, WorkflowExecution } from "../backends/backend.ts";
import {
  buildWorkflowRegistry,
  WorkflowRegistry,
} from "../registry/registries.ts";
import { wellKnownJWKSHandler } from "../security/identity.ts";
import { WorkflowService } from "./service.ts";

// as alias is immutable we can cache it forever.
const aliasCache: Record<string, Promise<string | undefined>> = {};
export const getRouter = async (
  app: Hono,
  db: DB,
  _registry?: WorkflowRegistry,
) => {
  const registry = _registry ?? await buildWorkflowRegistry();
  const service = new WorkflowService(
    db,
    registry,
  );
  const cachedVerifySignature = async (
    id: string,
    req: Request,
  ): Promise<boolean> => {
    aliasCache[id] ??= service.getExecution(id).then((execution) =>
      execution?.alias
    );
    const alias = await aliasCache[id];
    if (alias === undefined) {
      delete aliasCache[id];
      return false;
    }
    try {
      await registry.verifySignature(alias, req);
    } catch (err) {
      console.error(err);
      return false;
    }
    return true;
  };
  app.get("/.well_known/jwks.json", wellKnownJWKSHandler);
  app.post("/executions", async ({ req: { raw: req } }) => {
    const { alias, input, metadata, id } =
      (await req.json()) as WorkflowExecution;
    await registry.verifySignature(alias, req);
    return Response.json(
      await service.startExecution(
        { alias, executionId: id, metadata },
        Array.isArray(input) ? input : [input],
      ),
    );
  });
  app.get("/executions/:id", async ({ req }) => {
    const { id } = req.param();
    const execution = await service.getExecution(id);
    if (execution === undefined) {
      return Response.json({}, { status: 403 }); // do not expose not found errors.
    }
    await registry.verifySignature(execution.alias, req.raw);
    return Response.json(execution);
  });
  app.get("/executions/:id/history", async ({ req: _req }) => {
    const req = _req.raw;
    const { id } = _req.param();
    if (!await cachedVerifySignature(id, req)) {
      return Response.json({}, { status: 403 }); // do not expose not found errors.
    }
    const url = new URL(req.url);
    const page = url.searchParams.get("page");
    const pageSize = url.searchParams.get("pageSize");
    const history = await service.executionHistory(
      id,
      page ? +page : 0,
      pageSize ? +pageSize : 10,
    );
    if (history === undefined) {
      return Response.json({}, { status: 403 }); // do not expose not found errors.
    }
    return Response.json(history);
  });
  app.delete("/executions/:id", async (c) => {
    const req = c.req.raw;
    const { id } = c.req.param();
    if (!await cachedVerifySignature(id, req)) {
      return Response.json({}, { status: 403 }); // do not expose not found errors.
    }
    const reason = await req.json<{ reason: string }>().then((
      resp: { reason: string },
    ) => resp.reason);
    await service.cancelExecution(
      id,
      reason,
    );
    return Response.json(
      { id, reason },
    );
  });
  app.post("/executions/:id/signals/:signal", async (c) => {
    const req = c.req.raw;
    const { id, signal } = c.req.param();
    if (!await cachedVerifySignature(id, req)) {
      return Response.json({}, { status: 403 }); // do not expose not found errors.
    }
    await service.signalExecution(id, signal, await req.json());
    return Response.json(
      { id, signal },
    );
  });
  return app;
};
