import type { Hono } from "hono";
import type { DB, WorkflowExecution } from "../backends/backend.ts";
import { wellKnownJWKSHandler } from "../security/identity.ts";
import { withAuth } from "./auth.ts";
import { WorkflowService } from "./service.ts";

export const getRouter = async (
  _app: Hono,
  db: DB,
) => {
  const service = new WorkflowService(
    db,
  );
  _app.use("/.well_known/jwks.json", wellKnownJWKSHandler);
  const app = _app.basePath("/namespaces/:namespace");
  app.use("*", withAuth());
  app.post("/executions", async ({ req: { raw: req }, get }) => {
    const { workflow, input, metadata, id, runtimeParameters } =
      (await req.json()) as WorkflowExecution;

    const canRun = get("checkIsAllowed");
    canRun(workflow);
    return Response.json(
      await service.startExecution(
        { workflow, executionId: id, metadata, runtimeParameters },
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
    return Response.json(execution);
  });
  app.get("/executions/:id/_touch", async ({ req }) => {
    const { id } = req.param();
    const execution = await service.getExecution(id);
    if (execution === undefined) {
      return Response.json({}, { status: 403 }); // do not expose not found errors.
    }
    await service.touchExecution(id);
    return new Response(null, { status: 204 });
  });
  app.get("/executions/:id/history", async ({ req: _req }) => {
    const req = _req.raw;
    const { id } = _req.param();
    const url = new URL(req.url);
    if (url.searchParams.has("stream")) {
      return await service.executionHistoryStream(id, _req.signal);
    }
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
    await service.signalExecution(id, signal, await req.json());
    return Response.json(
      { id, signal },
    );
  });
  return app;
};
