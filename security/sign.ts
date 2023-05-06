import {
  decode,
  encode,
} from "https://deno.land/std@0.186.0/encoding/base64.ts";

const alg = "RSASSA-PKCS1-v1_5";
const hash = "SHA-256";
// Generate an RSA key pair
const keyPair = await crypto.subtle.generateKey(
  {
    name: alg,
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash,
  },
  true,
  ["sign", "verify"],
);
const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

// should be /.well_known/jwks.json
export const wellKnownJWKSHandler = () => Response.json({ keys: [publicKey] });

// Sign requests using the private key
const signRequest = async (data: string): Promise<string> => {
  const timestamp = Math.floor(Date.now() / 1000);
  const dataHash = await crypto.subtle.digest(
    hash,
    new TextEncoder().encode(`${data}.${timestamp}`),
  );
  const signature = await crypto.subtle.sign(
    {
      name: alg,
    },
    keyPair.privateKey,
    dataHash,
  );
  const encodedSignature = encode(new Uint8Array(signature));
  return `${data}.${timestamp}.${encodedSignature}`;
};

// Verify signatures using the public key
const verifySignature = async (signature: string): Promise<boolean> => {
  const [data, timestamp, sig] = signature.split("."); // validate if difference between now and timestamp is greather than 1s ?
  const dataHash = await crypto.subtle.digest(
    hash,
    new TextEncoder().encode(`${data}.${timestamp}`),
  );
  const signatureBuffer = decode(sig);

  // import key from /.well_known endpoint
  const pk = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: alg, hash },
    true,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    {
      name: alg,
    },
    pk,
    signatureBuffer,
    dataHash,
  );
  return verified;
};

const signed = await signRequest("euqueroisso");

console.log(signed);

const verified = await verifySignature(signed);

console.log(verified);
