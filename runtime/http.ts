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
  token: string,
): Workflow<TArgs, TResult, TCtx> => {
  return function* (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResult> {
    const commandResults: unknown[] = [];
    while (true) {
      try {
        commandResults.push(
          yield {
            name: "delegated",
            getCmd: async () => {
              return await signedFetch(url, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  ...(ctx.execution.runtimeParameters?.http?.defaultHeaders ??
                    {}),
                  "authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({
                  input: args,
                  results: commandResults,
                  execution: ctx.execution,
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
      } catch (error) {
        commandResults.push({ isException: true, error });
      }
    }
  };
};
