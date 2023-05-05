import { WorkflowContext } from "./context.ts";
import { useWorkflowRoutes, workflowHTTPHandler } from "./handler.ts";
import type { Workflow } from "./runtime/core/workflow.ts";
import { tryParseBool } from "./utils.ts";
export type { WorkflowExecution } from "./backends/backend.ts";
export { workflowRemoteRunner } from "./handler.ts";
export type { RunRequest } from "./handler.ts";
export type { InvokeHttpEndpointCommand } from "./runtime/core/commands.ts";
export type { WorkflowGen } from "./runtime/core/workflow.ts";
export type { Command } from "./runtime/core/commands.ts";
export type { Arg } from "./types.ts";

export {
  DEBUG_ENABLED,
  useWorkflowRoutes,
  Workflow,
  WorkflowContext,
  workflowHTTPHandler,
};

const DEBUG_ENABLED = tryParseBool(Deno.env.get("ENABLE_DEBUG")) ??
  false;
