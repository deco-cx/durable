export const alg = "RSASSA-PKCS1-v1_5";
export const hash = "SHA-256";

const PUBLIC_KEY_ENV_VAR = "WORKERS_PUBLIC_KEY";
const PRIVATE_KEY_ENV_VAR = "WORKERS_PRIVATE_KEY";

const generateKeyPair = async () => {
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
};

const getOrGenerateKeyPair = async (): Promise<[JsonWebKey, JsonWebKey]> => {
  const publicKeyEnvValue = Deno.env.get(PUBLIC_KEY_ENV_VAR);
  const privateKeyEnvValue = Deno.env.get(PRIVATE_KEY_ENV_VAR);
  if (!publicKeyEnvValue || !privateKeyEnvValue) {
    return await generateKeyPair();
  }
  return [
    JSON.parse(atob(publicKeyEnvValue)),
    JSON.parse(atob(privateKeyEnvValue)),
  ];
};
// Generate an RSA key pair
export let keys: null | Promise<[JsonWebKey, JsonWebKey]> = null;

export const getKeyPair = async () => {
  keys ??= getOrGenerateKeyPair();
  return await keys;
};
// rotate keys if necessary
if (import.meta.main) {
  const [kpub, kprivate] = await generateKeyPair();
  const pubKeyB64 = btoa(JSON.stringify(kpub));
  const privaKeyB64 = btoa(JSON.stringify(kprivate));
  const command = new Deno.Command("flyctl", {
    args: [
      "secrets",
      "set",
      `${PUBLIC_KEY_ENV_VAR}=${pubKeyB64}`,
      `${PRIVATE_KEY_ENV_VAR}=${privaKeyB64}`,
    ],
  });
  const process = command.spawn();
  await process.status;
}
