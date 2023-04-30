import { tryParseBool } from "./utils.ts";
import { WorkflowContext } from "./context.ts";
import { useWorkflowRoutes, workflowHTTPHandler } from "./handler.ts";
import type { Workflow } from "./runtime/core/workflow.ts";
export type { WorkflowExecution } from "./backends/backend.ts";
export type { InvokeHttpEndpointCommand } from "./runtime/core/commands.ts";

const DEBUG_ENABLED = tryParseBool(Deno.env.get("ENABLE_DEBUG")) ??
  false;

export {
  DEBUG_ENABLED,
  useWorkflowRoutes,
  Workflow,
  WorkflowContext,
  workflowHTTPHandler,
};
