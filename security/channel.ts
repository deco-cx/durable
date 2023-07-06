import { Event, Queue } from "https://deno.land/x/async@v1.2.0/mod.ts";
import { PromiseOrValue } from "../promise.ts";
import {
  channelEncryption,
  encryptedMessage,
  signMessage,
  VerifiedMessage,
  verifyMessage,
} from "./identity.ts";
import { importJWK } from "./keys.ts";

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
  const recv = new Queue<string>();
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
        if (!closed.is_set()) {
          socket.send(signed);
        }
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

/**
 * Adds durable encryption layer to the sent messages.
 */
export const asEncryptedChannel = async <Send, Recv>(
  socket: WebSocket,
): Promise<Channel<Send, Recv>> => {
  return asChannel<Send, Recv>(socket, await channelEncryption());
};
/**
 * Adds a layer of verification for received messages
 */
export const asVerifiedChannel = async <Send, Recv>(
  socket: WebSocket,
  key: PromiseOrValue<JsonWebKey>,
): Promise<Channel<Send, Recv>> => {
  return asChannel<Send, Recv>(socket, {
    recvPublicKey: await importJWK(await key, ["verify"]),
  });
};