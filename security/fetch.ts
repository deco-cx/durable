import { PromiseOrValue } from "../promise.ts";
import { signRequest } from "./identity.ts";

type FetchParams = Parameters<typeof fetch>;
/**
 * Adds the caller signature to the headers allowing receiveirs to validate the identity of the request.
 * @param req
 * @returns
 */
export const signedFetch = async (
  input: FetchParams[0],
  init?: FetchParams[1],
  key?: PromiseOrValue<CryptoKey>,
) => {
  const req = new Request(input, init);
  if (!req.headers.has("host")) {
    req.headers.set("host", new URL(req.url).host);
  }
  const body = init?.body;
  if (!req.headers.has("content-length") && body) {
    req.headers.set("content-length", `${body.toString().length}`);
  }
  return fetch(await signRequest(req, key));
};
