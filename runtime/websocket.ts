import { RunRequest } from "../handler.ts";
import { Workflow, WorkflowContext } from "../mod.ts";
import { WebSocketWorkflowRuntimeRef } from "../registry/registries.ts";
import { asEncryptedChannel } from "../security/channel.ts";
import { Arg } from "../types.ts";
import { Command } from "./core/commands.ts";
import { WorkflowGen } from "./core/workflow.ts";

export const websocket = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
>(
  { url }: Pick<WebSocketWorkflowRuntimeRef, "url">,
): Workflow<TArgs, TResult, TCtx> => {
  const socket = new WebSocket(url);
  const channelPromise = asEncryptedChannel<RunRequest, Command>(socket);
  const workflowFunc: Workflow<TArgs, TResult, TCtx> = function* (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResult> {
    const commandResults: unknown[] = [args];
    while (true) {
      commandResults.push(
        yield {
          name: "delegated",
          getCmd: async () => {
            const channel = await channelPromise;
            if (channel.closed.is_set()) {
              throw new Error(
                "channel was closed before message is transmitted",
              );
            }
            // TODO (mcandeia) this can be improved by just sending the new commands instead the entire command chain again.
            channel.send({
              results: commandResults as RunRequest["results"],
              executionId: ctx.executionId,
              metadata: ctx.metadata!,
            });
            const cmd = await Promise.race([
              channel.recv(),
              channel.closed.wait(),
            ]);
            if (cmd === true) {
              throw new Error(
                "channel was closed before message is transmitted",
              );
            }
            return cmd;
          },
        },
      );
    }
  };
  workflowFunc.dispose = () => socket.close();
  return workflowFunc;
};
