import { deferred } from "std/async/deferred.ts";
import { Workflow, WorkflowContext } from "../mod.ts";
import { HttpWorkflowRuntimeRef } from "../registry/registries.ts";
import { signedFetch } from "../security/fetch.ts";
import { Arg } from "../types.ts";
import { WorkflowGen } from "./core/workflow.ts";

export const websocket = <
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
    const socket = new WebSocket(url);
    const waitToBeReady = deferred();
    socket.addEventListener("open", () => {
      waitToBeReady.resolve();
    });

    const commandResults: unknown[] = [args];
    while (true) {
      commandResults.push(
        yield {
          name: "delegated",
          getCmd: async () => {
            await waitToBeReady;
            return await signedFetch(url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
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
