import { WorkflowContext } from "../context.ts";
import { WebSocketWorkflowRuntimeRef } from "../registry/registries.ts";
import { WebSocketRunRequest } from "../sdk/deno/handler.ts";
import { asEncryptedChannel, Channel } from "../security/channel.ts";
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
  let socket: null | WebSocket = null;
  let channelPromise:
    | null
    | Promise<
      Channel<
        WebSocketRunRequest | unknown,
        Command
      >
    > = null;
  const workflowFunc: Workflow<TArgs, TResult, TCtx> = function* (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResult> {
    const _url = new URL(url);
    for (
      const [key, value] of Object.entries(
        ctx.runtimeParameters?.websocket?.defaultQueryParams ?? {},
      )
    ) {
      _url.searchParams.set(key, value);
    }
    socket = new WebSocket(_url.toString());
    channelPromise = asEncryptedChannel<
      WebSocketRunRequest | unknown,
      Command
    >(socket);
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
            if (cmd.name === "local_activity") { // send it back to allow to run.
              const isClosed = await Promise.race([
                channel.send(cmd),
                channel.closed.wait(),
              ]);
              if (typeof isClosed === "boolean") {
                throw new Error(
                  "channel was closed before message is transmitted",
                );
              }
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
    channelPromise?.then((c) => {
      c.closed.set();
    }).finally(() => {
      socket?.close();
    });
  };
  return workflowFunc;
};
