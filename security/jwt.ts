import { create, decode, verify } from "../djwt.js";
import { importJWK, importJWKFromString } from "./keys.ts";

export interface JwtPayload {
  [key: string]: any;
  iss?: string | undefined;
  sub?: string | undefined;
  aud?: string | string[] | undefined;
  exp?: number | undefined;
  nbf?: number | undefined;
  iat?: number | undefined;
  jti?: string | undefined;
  scopes?: string[] | undefined;
}

export interface JwtIssuerKeyPair {
  public: string | JsonWebKey;
  private: string | JsonWebKey;
}

export type JwtPayloadWithClaims<
  TClaims extends Record<string, unknown> = Record<string, unknown>,
> = JwtPayload & TClaims;

export interface JwtVerifier {
  verify: <TClaims extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
  ) => Promise<JwtPayloadWithClaims<TClaims>>;
  decode: <TClaims extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
  ) => JwtPayloadWithClaims<TClaims>;
}

export interface JwtIssuer extends JwtVerifier {
  issue: <TClaims extends Record<string, unknown> = Record<string, unknown>>(
    payload: JwtPayloadWithClaims<TClaims>,
  ) => Promise<string>;
}

export const newJwtVerifier = (key: CryptoKey): JwtVerifier => {
  return {
    verify: (str: string) => {
      return verify(str, key);
    },
    decode: (str: string) => {
      return decode(str);
    },
  };
};

export const newJwtVerifierWithJWK = async (
  pubKey: string | JsonWebKey,
): Promise<JwtVerifier> => {
  const pub = await importKey(
    pubKey,
    ["verify"],
  );
  return newJwtVerifier(pub);
};

const importKey = (
  key: string | JsonWebKey,
  usages: string[],
): Promise<CryptoKey> => {
  if (typeof key === "string") {
    return importJWKFromString(key, usages);
  }
  return importJWK(key, usages);
};

export const newJwtIssuer = async (
  { private: privkey, public: pubkey }: JwtIssuerKeyPair,
  issuer?: string,
): Promise<JwtIssuer> => {
  const [verifier, priv] = await Promise.all([
    newJwtVerifierWithJWK(pubkey),
    importKey(privkey, ["sign"]),
  ]);
  return {
    ...verifier,
    issue: (payload) => {
      return create({ alg: "RS256", typ: "JWT" }, { ...payload, issuer }, priv);
    },
  };
};
