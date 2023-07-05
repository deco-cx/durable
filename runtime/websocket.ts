import { Event, Queue } from "https://deno.land/x/async@v1.2.0/mod.ts";
import { RunRequest } from "../handler.ts";
import { Workflow, WorkflowContext } from "../mod.ts";
import { WebSocketWorkflowRuntimeRef } from "../registry/registries.ts";
import { Arg } from "../types.ts";
import { Command } from "./core/commands.ts";
import { WorkflowGen } from "./core/workflow.ts";

interface Channel<Send, Recv> {
  send: (data: Send) => Promise<Recv>;
  closed: Event;
}
export const asChannel = async <Send, Recv>(
  socket: WebSocket,
): Promise<Channel<Send, Recv>> => {
  const ready = new Event();
  const recv = new Queue<Recv>(1);
  const closed = new Event();
  socket.addEventListener("open", () => {
    ready.set();
  });
  socket.addEventListener("close", () => {
    closed.set();
  });
  socket.addEventListener("message", (event) => {
    recv.put(JSON.parse(event.data));
  });

  await Promise.race([ready.wait(), closed.wait()]);
  return {
    send: (data: Send) => {
      socket.send(JSON.stringify(data));
      return recv.get();
    },
    closed,
  };
};
export const websocket = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
>(
  { url }: Pick<WebSocketWorkflowRuntimeRef, "url">,
): Workflow<TArgs, TResult, TCtx> => {
  const socket = new WebSocket(url);
  const channelPromise = asChannel<RunRequest, Command>(socket);
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
            const cmd = await Promise.race([
              channel.send({
                results: commandResults as RunRequest["results"],
                executionId: ctx.executionId,
                metadata: ctx.metadata!,
              }),
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
