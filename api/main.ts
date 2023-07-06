import { serve } from "https://deno.land/std@0.173.0/http/server.ts";
import { router } from "https://deno.land/x/rutt@0.0.14/mod.ts";
import { DB } from "../backends/backend.ts";
import { postgres } from "../backends/postgres/db.ts";
import {
  buildWorkflowRegistry,
  WorkflowRegistry,
} from "../registry/registries.ts";
import { wellKnownJWKSHandler } from "../security/identity.ts";
import { WorkflowService } from "./service.ts";

// as alias is immutable we can cache it forever.
const aliasCache: Record<string, Promise<string | undefined>> = {};
export const start = async (db?: DB, _registry?: WorkflowRegistry) => {
  const registry = _registry ?? await buildWorkflowRegistry();
  const service = new WorkflowService(
    db ?? await postgres(),
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
  return await serve(
    router({
      "GET@/.well_known/jwks.json": wellKnownJWKSHandler,
      "POST@/executions": async (req) => {
        const { alias, input, metadata, id } = await req.json();
        await registry.verifySignature(alias, req);
        return Response.json(
          await service.startExecution(
            { alias, executionId: id, metadata },
            Array.isArray(input) ? input : [input],
          ),
        );
      },
      "GET@/executions": (_req) =>
        new Response("NOT IMPLEMENTED", { status: 501 }),
      "GET@/executions/:id": async (_req, _, { id }) => {
        const execution = await service.getExecution(id);
        if (execution === undefined) {
          return Response.json({}, { status: 403 }); // do not expose not found errors.
        }
        await registry.verifySignature(execution.alias, _req);
        return Response.json(execution);
      },
      "GET@/executions/:id/history": async (req, _, { id }) => {
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
      },
      "DELETE@/executions/:id": async (req, _, { id }) => {
        if (!await cachedVerifySignature(id, req)) {
          return Response.json({}, { status: 403 }); // do not expose not found errors.
        }
        const reason = await req.json().then((resp) => resp.reason as string);
        await service.cancelExecution(
          id,
          reason,
        );
        return Response.json(
          { id, reason },
        );
      },
      "POST@/executions/:id/signals/:signal": async (
        req,
        _,
        { id, signal },
      ) => {
        if (!await cachedVerifySignature(id, req)) {
          return Response.json({}, { status: 403 }); // do not expose not found errors.
        }
        await service.signalExecution(id, signal, await req.json());
        return Response.json(
          { id, signal },
        );
      },
    }),
    { port: 8001 },
  );
};

if (import.meta.main) {
  await start();
}
