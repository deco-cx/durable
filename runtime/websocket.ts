import { WorkflowContext } from "../context.ts";
import { WebSocketWorkflowRuntimeRef } from "../registry/registries.ts";
import { asChannel } from "../security/channel.ts";
import { Arg } from "../types.ts";
import { Command } from "./core/commands.ts";
import { Workflow, WorkflowGen } from "./core/workflow.ts";

export const websocket = async <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
>(
  { url }: Pick<WebSocketWorkflowRuntimeRef, "url">,
  token: string,
): Promise<Workflow<TArgs, TResult, TCtx>> => {
  const _url = new URL(url);
  _url.searchParams.set("token", token);

  const socket = new WebSocket(_url.toString());
  const channel = await asChannel<unknown, Command>(socket);
  const workflowFunc: Workflow<TArgs, TResult, TCtx> = function* (
    ctx: TCtx,
    ...args: [...TArgs]
  ): WorkflowGen<TResult> {
    if (!channel.closed.is_set()) {
      channel.send({
        input: args,
        execution: ctx.execution,
      });
    }

    const events: unknown[] = [];

    let index = 0;
    const firstCommand: Promise<Command | boolean> = Promise.race([
      channel.recv(),
      channel.closed.wait(),
    ]);
    while (true) {
      try {
        events.push(
          yield {
            name: "delegated",
            getCmd: async () => {
              let cmd: Command | boolean = await firstCommand;
              for (; index < events.length && cmd !== true; index++) {
                const isClosed = await Promise.race([
                  channel.send(events[index]),
                  channel.closed.wait(),
                ]);
                if (isClosed === true) {
                  break;
                }
                cmd = await Promise.race([
                  channel.recv(),
                  channel.closed.wait(),
                ]);
              }
              if (cmd === null) {
                cmd = await Promise.race([
                  channel.recv(),
                  channel.closed.wait(),
                ]);
              }

              if (typeof cmd === "boolean") {
                throw new Error(
                  "channel was closed before message is transmitted(1)",
                );
              }
              if (cmd.name === "local_activity") { // send it back to allow to run.
                const isClosed = await Promise.race([
                  channel.send(cmd),
                  channel.closed.wait(),
                ]);
                if (typeof isClosed === "boolean") {
                  throw new Error(
                    "channel was closed before message is transmitted(2)",
                  );
                }
                cmd = await Promise.race([
                  channel.recv(),
                  channel.closed.wait(),
                ]);
              }
              if (typeof cmd === "boolean") {
                throw new Error(
                  "channel was closed before message is transmitted(3)",
                );
              }

              return cmd;
            },
          },
        );
      } catch (error) {
        events.push({ isException: true, error });
      }
    }
  };
  workflowFunc.dispose = () => {
    channel.closed.set();
    socket?.close();
  };
  return workflowFunc;
};
