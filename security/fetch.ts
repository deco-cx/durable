import { signRequest } from "./identity.ts";

type FetchParams = Parameters<typeof fetch>;
/**
 * Adds the worker signature to the headers allowing receiveirs to validate the identity of the request.
 * @param req
 * @returns
 */
export const signedFetch = async (
  input: FetchParams[0],
  init?: FetchParams[1],
) => {
  const req = new Request(input, init);
  return fetch(await signRequest(req));
};
