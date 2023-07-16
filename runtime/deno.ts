import { WorkflowContext } from "../context.ts";
import { DenoWorkflowRuntimeRef } from "../registry/registries.ts";
import { Arg } from "../types.ts";
import { Workflow } from "./core/workflow.ts";

export const deno = async <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
>(
  { url }: Pick<DenoWorkflowRuntimeRef, "url">,
): Promise<Workflow<TArgs, TResult, TCtx>> => {
  const module = await import(url);
  if (typeof module?.default !== "function") {
    throw new Error(`invalid workflow module: ${module}`);
  }
  return module.default as Workflow<TArgs, TResult, TCtx>;
};
