import { Workflow } from "../mod.ts";
import { DenoWorkflowRuntimeRef } from "../registry/registries.ts";
import { Arg } from "../types.ts";

export const deno = async <TArgs extends Arg = Arg, TResult = unknown>(
  { url }: Pick<DenoWorkflowRuntimeRef, "url">,
): Promise<Workflow<TArgs, TResult>> => {
  const module = await import(url);
  if (typeof module?.default !== "function") {
    throw new Error(`invalid workflow module: ${module}`);
  }
  return module.default as Workflow<TArgs, TResult>;
};
