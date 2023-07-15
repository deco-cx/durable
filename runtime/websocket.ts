import { WorkflowContext } from "../context.ts";
import { WebSocketWorkflowRuntimeRef } from "../registry/registries.ts";
import { WebSocketRunRequest } from "../sdk/deno/handler.ts";
import { asEncryptedChannel } from "../security/channel.ts";
import { Arg } from "../types.ts";
import { Command } from "./core/commands.ts";
import { Workflow, WorkflowGen } from "./core/workflow.ts";

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

    const events: unknown[] = [];

    let index = 0;
    const firstCommand = initializedChannel.then((c) =>
      Promise.race([c.recv(), c.closed.wait()])
    );
    while (true) {
      events.push(
        yield {
          name: "delegated",
          getCmd: async () => {
            const channel = await initializedChannel;
            if (channel.closed.is_set()) {
              throw new Error(
                "channel was closed before message is transmitted",
              );
            }

            let cmd: Command | boolean = await firstCommand;
            for (; index < events.length && cmd !== true; index++) {
              const isClosed = await Promise.race([
                channel.send(events[index]),
                channel.closed.wait(),
              ]);
              if (isClosed === true) {
                break;
              }
              cmd = await Promise.race([channel.recv(), channel.closed.wait()]);
            }
            if (cmd === null) {
              cmd = await Promise.race([channel.recv(), channel.closed.wait()]);
            }

            if (typeof cmd === "boolean") {
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
  workflowFunc.dispose = () => {
    channelPromise.then((c) => {
      c.closed.set();
    }).finally(() => {
      socket.close();
    });
  };
  return workflowFunc;
};
