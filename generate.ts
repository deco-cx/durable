import { getKeyPair } from "./security/keys.ts";
const [pubKey, privKey] = await getKeyPair();

console.log(btoa(JSON.stringify(pubKey)))

console.log(btoa(JSON.stringify(privKey)))
