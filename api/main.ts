import { serve } from "https://deno.land/std@0.173.0/http/server.ts";
import { router } from "https://deno.land/x/rutt@0.0.14/mod.ts";
import { postgres } from "../backends/postgres/db.ts";
import { WorkflowService } from "./service.ts";
import { DB } from "../backends/backend.ts";

export const start = async (db?: DB) => {
  const service = new WorkflowService(db ?? postgres());
  return await serve(
    router({
      "POST@/executions": async (req) => {
        const { alias, input, metadata, id } = await req.json();
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
          return Response.json({}, { status: 404 });
        }
        return Response.json(execution);
      },
      "GET@/executions/:id/history": async (req, _, { id }) => {
        const url = new URL(req.url);
        const page = url.searchParams.get("page");
        const pageSize = url.searchParams.get("pageSize");
        const history = await service.executionHistory(
          id,
          page ? +page : 0,
          pageSize ? +pageSize : 10,
        );
        if (history === undefined) {
          return Response.json({}, { status: 404 });
        }
        return Response.json(history);
      },
      "DELETE@/executions/:id": async (req, _, { id }) => {
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
