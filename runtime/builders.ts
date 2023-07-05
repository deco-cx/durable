import { PromiseOrValue } from "../promise.ts";
import { GenericWorkflow, WorkflowRuntimeRef } from "../registry/registries.ts";
import { deno } from "./deno.ts";
import { http } from "./http.ts";
import { websocket } from "./websocket.ts";

type RuntimeFactory = (
  e: WorkflowRuntimeRef,
) => PromiseOrValue<GenericWorkflow>;

export const runtimeBuilder: Record<
  WorkflowRuntimeRef["type"],
  RuntimeFactory
> = {
  deno,
  http,
  websocket,
};
