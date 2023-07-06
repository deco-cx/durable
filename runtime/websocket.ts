import { Event, Queue } from "https://deno.land/x/async@v1.2.0/mod.ts";
import { RunRequest } from "../handler.ts";
import { Workflow, WorkflowContext } from "../mod.ts";
import { WebSocketWorkflowRuntimeRef } from "../registry/registries.ts";
import { asEncryptedChannel } from "../security/channel.ts";
import {
  encryptedMessage,
  signMessage,
  VerifiedMessage,
  verifyMessage,
} from "../security/identity.ts";
import { Arg } from "../types.ts";
import { Command } from "./core/commands.ts";
import { WorkflowGen } from "./core/workflow.ts";

export interface ChannelEncryption {
  sendPrivateKey?: CryptoKey;
  recvPublicKey?: CryptoKey;
}
export interface Channel<Send, Recv> {
  send: (data: Send) => Promise<void>;
  recv: () => Promise<Recv>;
  closed: Event;
  encryption?: ChannelEncryption;
}

interface Encryption {
  sign: (data: string) => Promise<string>;
  verify: (data: string) => Promise<VerifiedMessage>;
}
const bypassSign: Encryption["sign"] = (data) => Promise.resolve(data);
const bypassVerify: Encryption["verify"] = (data) =>
  Promise.resolve({ encoded: data, isValid: true, data });

const useChannelEncryption = (encryption?: ChannelEncryption): Encryption => {
  const sendPrivateKey = encryption?.sendPrivateKey;
  const recvPublicKey = encryption?.recvPublicKey;

  const verify: Encryption["verify"] = recvPublicKey
    ? (data) =>
      verifyMessage(
        encryptedMessage.fromString(data),
        recvPublicKey,
      )
    : bypassVerify;

  const sign: Encryption["sign"] = sendPrivateKey
    ? (data) =>
      signMessage(data, sendPrivateKey, true).then(
        encryptedMessage.toString,
      )
    : bypassSign;
  return { sign, verify };
};
export const asChannel = async <Send, Recv>(
  socket: WebSocket,
  encryption?: ChannelEncryption,
): Promise<Channel<Send, Recv>> => {
  const { sign, verify } = useChannelEncryption(encryption);
  const ready = new Event();
  const recv = new Queue<string>(1);
  const closed = new Event();
  socket.addEventListener("open", () => {
    ready.set();
  });
  socket.addEventListener("close", () => {
    closed.set();
  });
  socket.addEventListener("message", (event) => {
    recv.put(event.data);
  });

  await Promise.race([ready.wait(), closed.wait()]);
  return {
    send: async (data: Send) => {
      const stringifiedData = JSON.stringify(data);
      await sign(stringifiedData).then((signed) => {
        socket.send(signed);
      });
    },
    recv: async () => {
      const received = await recv.get();
      const { isValid, data } = await verify(received);
      if (!isValid) {
        throw new Error("channel encryption does not match");
      }
      return data ? JSON.parse(data) : {};
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
