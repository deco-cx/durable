import { Workflow, WorkflowContext } from "../mod.ts";
import { HttpWorkflowRuntimeRef } from "../registry/registries.ts";
import { Arg } from "../types.ts";
import { WorkflowGen } from "./core/workflow.ts";

export const http = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
>(
  { url }: Pick<HttpWorkflowRuntimeRef, "url">,
): Workflow<TArgs, TResult, TCtx> => {
  return function* (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResult> {
    const commandResults: unknown[] = [args];
    while (true) {
      commandResults.push(
        yield {
          name: "delegated",
          getCmd: async () => {
            return await fetch(url, {
              method: "POST",
              body: JSON.stringify({
                results: commandResults,
                executionId: ctx.executionId,
                metadata: ctx.metadata,
              }),
            }).then(async (resp) => {
              const msg = await resp.json();
              if (resp.status >= 400) {
                throw new Error(
                  `error when fetching new command ${resp.status} ${
                    JSON.stringify(msg)
                  }`,
                );
              }
              return msg;
            });
          },
        },
      );
    }
  };
};
