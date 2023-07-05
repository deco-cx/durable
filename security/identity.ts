import {
  decode,
  encode,
} from "https://deno.land/std@0.186.0/encoding/base64.ts";
import { PromiseOrValue } from "../promise.ts";
import { alg, getKeyPair, hash, importJWK } from "./keys.ts";

const sigName = "sig1";

let pkCrypto: null | Promise<CryptoKey> = null;

const getPkCrypto = async () => {
  const [_, privateKey] = await getKeyPair();
  pkCrypto ??= importJWK(privateKey);
  return await pkCrypto;
};

const getPublicKey = async () => {
  const [publicKey] = await getKeyPair();
  return publicKey;
};

const signatureHeaders = ["host", "content-length", "date"];
const signatureParamsInput = `@signature-params`;
const requestTargetInput = `@request-target`;

const requestTarget = (req: Request) => {
  const url = new URL(req.url);

  return `"(${requestTargetInput})": ${req.method.toLowerCase()} ${url.pathname}${
    url.search ? `?${url.search}` : ""
  }`;
};

const SIGNATURE_HEADER = "signature";
const SIGNATURE_HEADER_INPUT = "signature-input";

const getSignatureParams = (req: Request) => {
  const params = req.headers.get(SIGNATURE_HEADER_INPUT);

  return `"(${signatureParamsInput})": ${params}`;
};
const buildReqSign = (req: Request) => {
  const sign = [requestTarget(req), getSignatureParams(req)];

  for (const header of signatureHeaders) {
    sign.push(`"${header}": ${req.headers.get(header) ?? ""}`);
  }
  return sign.join("\n");
};

const parseSignatureHeader = (sig: string): Record<string, string> => {
  const splitBySignature = sig.split(";"); //format sigName=:sigValue:
  const sigMap: Record<string, string> = {};
  for (const sig of splitBySignature) {
    const [name, ...values] = sig.split("=");
    const value = values.join("="); //base64 values
    sigMap[name] = value.substring(1, value.length - 1);
  }
  return sigMap;
};

const keyId = "durable-workers-key";

// should be /.well_known/jwks.json
export const wellKnownJWKSHandler = async () =>
  Response.json({ keys: [{ ...await getPublicKey(), kid: keyId }] });

export const fetchPublicKey = async (
  service: string,
  kid?: string,
): Promise<JsonWebKey> => {
  const response = await fetch(`${service}/.well_known/jwks.json`);
  if (response.ok) {
    const { keys } = await response.json();
    return (keys ?? []).find((key: { kid: string }) =>
      key?.kid === (kid ?? keyId)
    );
  }
  throw new Error(
    `${response.status} when trying to retrieve public key from workers ${service}`,
  );
};
const signatureParams = [
  `"${signatureParamsInput}"`,
  `"${requestTargetInput}"`,
  ...signatureHeaders.map((h) => `"${h}"`),
];

// Sign requests using the private key
export const signRequestWith = async (
  req: Request,
  pkCrypto: PromiseOrValue<CryptoKey>,
): Promise<Request> => {
  const now = Date.now();
  if (!req.headers.has("date")) {
    req.headers.set("date", new Date(now).toISOString());
  }
  const created = Math.floor(now / 1000);
  req.headers.set(
    SIGNATURE_HEADER_INPUT,
    `${sigName}=(${
      signatureParams.join(" ")
    });created=${created};keyid="${keyId}"`,
  );

  const data = buildReqSign(req);
  const [dataHash, pk] = await Promise.all([
    crypto.subtle.digest(
      hash,
      new TextEncoder().encode(data),
    ),
    pkCrypto,
  ]);
  const signature = await crypto.subtle.sign(
    {
      name: alg,
    },
    pk,
    dataHash,
  );
  const encodedSignature = encode(new Uint8Array(signature));
  req.headers.set(
    SIGNATURE_HEADER,
    `${sigName}=:${encode(new Uint8Array(dataHash))}.${encodedSignature}:`,
  );

  return req;
};

// Sign requests using the private key
export const signRequest = (
  req: Request,
  key?: PromiseOrValue<CryptoKey>,
): Promise<Request> => {
  return signRequestWith(req, key ?? getPkCrypto());
};

export interface SignatureInput {
  createdAt: Date;
  keyId: string;
  sig: string;
}

export class InvalidSignatureError extends Error {
  constructor() {
    super("Something went wrong");
  }
}

// Verify signatures using the public key
export const verifySignature = async (
  req: Request,
  key: JsonWebKey | Promise<JsonWebKey>,
): Promise<SignatureInput> => {
  const _signature = req.headers.get(SIGNATURE_HEADER);
  if (!_signature || _signature.length === 0) {
    throw new Error(`Something went wrong`); // do not expose that the signature is invalid
  }
  const { [sigName]: signAndData } = parseSignatureHeader(_signature);
  const [verifyAgainstHash, signature] = signAndData.split(".");

  const dataHash = decode(verifyAgainstHash);

  const signatureBuffer = decode(signature);

  // import key from /.well_known endpoint
  const pk = await importJWK(await key, ["verify"]);
  const verified = await crypto.subtle.verify(
    {
      name: alg,
    },
    pk,
    signatureBuffer,
    dataHash,
  );
  if (!verified) {
    throw new InvalidSignatureError(); // do not expose that the signature is invalid
  }
  const date = req.headers.get("date") ?? Date.now();
  return {
    createdAt: new Date(date),
    keyId,
    sig: sigName,
  };
};
