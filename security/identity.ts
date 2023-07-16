import { PromiseOrValue } from "../promise.ts";
import { decode, encode } from "./base64.ts";
import { ChannelEncryption } from "./channel.ts";
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
    const { keys }: { keys: Array<JsonWebKey & { kid: string }> } =
      await response.json();
    return (keys ?? []).find((key: { kid: string }) =>
      key?.kid === (kid ?? keyId)
    )!;
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

export interface EncryptedMessage {
  encoded: string;
  encrypted: string;
  data?: string;
}
const verifyMessageWith = async (
  msg: EncryptedMessage,
  key: PromiseOrValue<JsonWebKey>,
) => {
  return verifyMessage(msg, importJWK(await key, ["verify"]));
};

export interface VerifiedMessage {
  encoded: string;
  isValid: boolean;
  data?: string;
}
export const verifyMessage = async (
  { encoded: verifyAgainstHash, encrypted: signature, data }: EncryptedMessage,
  pk: PromiseOrValue<CryptoKey>,
): Promise<VerifiedMessage> => {
  const dataHash = decode(verifyAgainstHash);

  const signatureBuffer = decode(signature);
  const encodedData = data
    ? stringToBase64SHA256(data)
    : Promise.resolve(verifyAgainstHash);

  const verified = await crypto.subtle.verify(
    {
      name: alg,
    },
    await pk,
    signatureBuffer,
    dataHash,
  );
  return {
    isValid: verified && (await encodedData) === verifyAgainstHash,
    encoded: verifyAgainstHash,
    data,
  };
};

const SEPARATOR = ".";
export const encryptedMessage = {
  fromString: (data: string): EncryptedMessage => {
    const [encoded, encrypted, maybeData] = data.split(SEPARATOR);
    return {
      encoded,
      encrypted,
      data: maybeData ? atob(maybeData) : undefined,
    };
  },
  toString: ({ encoded, encrypted, data }: EncryptedMessage): string => {
    return `${encoded}${SEPARATOR}${encrypted}${
      data ? `${SEPARATOR}${btoa(data)}` : ""
    }`;
  },
};

const stringToSHA256 = (txt: string) => {
  return crypto.subtle.digest(
    hash,
    new TextEncoder().encode(txt),
  );
};

/**
 * Encode a given message to string.
 */
export const stringToBase64SHA256 = async (txt: string) => {
  return await stringToSHA256(txt).then((encoded) =>
    encode(new Uint8Array(encoded))
  );
};

export const signMessage = async (
  msg: string,
  pkCrypto: PromiseOrValue<CryptoKey>,
  includeData = false,
): Promise<EncryptedMessage> => {
  const [msgHash, pk] = await Promise.all([
    stringToSHA256(msg),
    pkCrypto,
  ]);
  const encrypted = await crypto.subtle.sign(
    {
      name: alg,
    },
    pk,
    msgHash,
  );

  return {
    ...(includeData ? { data: msg } : {}),
    encoded: encode(new Uint8Array(msgHash)),
    encrypted: encode(new Uint8Array(encrypted)),
  };
};
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
  const message = await signMessage(data, pkCrypto);
  req.headers.set(
    SIGNATURE_HEADER,
    `${sigName}=:${encryptedMessage.toString(message)}:`,
  );

  return req;
};

/**
 * Returns the channel used to encrypt sends.
 */
export const channelEncryption = async (
  key?: PromiseOrValue<CryptoKey>,
): Promise<ChannelEncryption> => {
  return {
    sendPrivateKey: await (key ?? getPkCrypto()),
  };
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
  const verified = await verifyMessageWith(
    encryptedMessage.fromString(signAndData),
    key,
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
