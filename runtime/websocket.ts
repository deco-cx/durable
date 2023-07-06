import { WebSocketRunRequest } from "../handler.ts";
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
  const channelPromise = asEncryptedChannel<
    WebSocketRunRequest | unknown,
    Command
  >(socket);
  const workflowFunc: Workflow<TArgs, TResult, TCtx> = function* (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResult> {
    let currentEvent: unknown = null;
    const initializedChannel = channelPromise.then((c) => {
      if (!c.closed.is_set()) {
        c.send({
          input: args,
          executionId: ctx.executionId,
          metadata: ctx.metadata,
        });
      }
      return c;
    });
    while (true) {
      currentEvent = yield {
        name: "delegated",
        getCmd: async () => {
          const channel = await initializedChannel;
          if (channel.closed.is_set()) {
            throw new Error(
              "channel was closed before message is transmitted",
            );
          }

          if (currentEvent !== null) {
            await channel.send(currentEvent);
          }

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
      };
    }
  };
  workflowFunc.dispose = () => socket.close();
  return workflowFunc;
};
