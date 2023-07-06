import { PromiseOrValue } from "../promise.ts";
import { asChannel, Channel } from "../runtime/websocket.ts";
import { channelEncryption } from "./identity.ts";
import { importJWK } from "./keys.ts";

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
