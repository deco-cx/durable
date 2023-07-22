// deno-lint-ignore-file no-explicit-any
import { Workflow } from "../runtime/core/workflow.ts";

export interface WorkflowRuntimeRefBase {
  type: string;
  alias?: string;
}
export interface DenoWorkflowRuntimeRef extends WorkflowRuntimeRefBase {
  type: "deno";
  url: string;
}

export interface HttpWorkflowRuntimeRef extends WorkflowRuntimeRefBase {
  type: "http";
  url: string;
}

export interface WebSocketWorkflowRuntimeRef extends WorkflowRuntimeRefBase {
  type: "websocket";
  url: string;
}

export type WorkflowRuntimeRef =
  | DenoWorkflowRuntimeRef
  | HttpWorkflowRuntimeRef
  | WebSocketWorkflowRuntimeRef;

export type GenericWorkflow = Workflow<any, any, any>;
