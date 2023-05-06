export const alg = "RSASSA-PKCS1-v1_5";
export const hash = "SHA-256";

const PUBLIC_KEY_ENV_VAR = "WORKERS_PUBLIC_KEY";
const PRIVATE_KEY_ENV_VAR = "WORKERS_PRIVATE_KEY";
const getOrGenerateKeyPair = async (): Promise<[JsonWebKey, JsonWebKey]> => {
  const publicKeyEnvValue = Deno.env.get(PUBLIC_KEY_ENV_VAR);
  const privateKeyEnvValue = Deno.env.get(PRIVATE_KEY_ENV_VAR);
  if (!publicKeyEnvValue || !privateKeyEnvValue) {
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
    return await Promise.all([
      crypto.subtle.exportKey("jwk", keyPair.publicKey),
      crypto.subtle.exportKey("jwk", keyPair.privateKey),
    ]);
  }
  return [
    JSON.parse(atob(publicKeyEnvValue)),
    JSON.parse(atob(privateKeyEnvValue)),
  ];
};
// Generate an RSA key pair
export const [publicKey, privateKey] = await getOrGenerateKeyPair();
