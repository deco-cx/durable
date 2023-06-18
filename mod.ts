import { WorkflowContext } from "./context.ts";
import { useWorkflowRoutes, workflowHTTPHandler } from "./handler.ts";
import type { Workflow } from "./runtime/core/workflow.ts";
import { tryParseBool } from "./utils.ts";
export type { WorkflowExecution } from "./backends/backend.ts";
export type { Metadata } from "./context.ts";
export { workflowRemoteRunner } from "./handler.ts";
export type { RunRequest } from "./handler.ts";
export type {
  Command,
  InvokeHttpEndpointCommand,
} from "./runtime/core/commands.ts";
export type { WorkflowGen } from "./runtime/core/workflow.ts";
export {
  fetchPublicKey,
  InvalidSignatureError,
  signRequest,
  verifySignature,
  wellKnownJWKSHandler,
} from "./security/identity.ts";
export type { Arg } from "./types.ts";
export {
  DEBUG_ENABLED,
  useWorkflowRoutes,
  Workflow,
  WorkflowContext,
  workflowHTTPHandler,
};

const DEBUG_ENABLED = typeof Deno === "undefined"
  ? false
  : tryParseBool(Deno.env.get("ENABLE_DEBUG")) ??
    false;
