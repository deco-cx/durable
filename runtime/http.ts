import { WorkflowContext } from "../context.ts";
import { HttpWorkflowRuntimeRef } from "../registry/registries.ts";
import { signedFetch } from "../security/fetch.ts";
import { Arg } from "../types.ts";
import { Command } from "./core/commands.ts";
import { Workflow, WorkflowGen } from "./core/workflow.ts";

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
    const commandResults: unknown[] = [];
    while (true) {
      commandResults.push(
        yield {
          name: "delegated",
          getCmd: async () => {
            return await signedFetch(url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(ctx.runtimeParameters?.http?.defaultHeaders ?? {}),
              },
              body: JSON.stringify({
                input: args,
                results: commandResults,
                executionId: ctx.executionId,
                metadata: ctx.metadata,
              }),
            }).then(async (resp) => {
              const msg: Command = await resp.json();
              if (resp.status >= 400) {
                throw new Error(
                  `error when fetching new command ${resp.status} ${
                    JSON.stringify(msg)
                  }`,
                );
              }
              return msg;
            }).catch((err) => {
              console.log("err", err);
              throw err;
            });
          },
        },
      );
    }
  };
};
