import { Env, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { verify } from "../djwt.js";
import { WorkflowRuntimeRef } from "../registry/registries.ts";
import { newJwksIssuer } from "../security/jwks.ts";
import { JwtPayload } from "../security/jwt.ts";

declare module "hono" {
  interface ContextVariableMap {
    principal: JwtPayload;
    checkIsAllowed: (wkflow: WorkflowRuntimeRef) => void;
  }
}

const matches = (urnParts: string[]) => (resourceUrn: string) => {
  const resourceParts = resourceUrn
    .split(":");
  return resourceParts.every((part, idx) =>
    part === "*" || part === urnParts[idx]
  );
};
const trustedIssuers: string[] = [
  "urn:deco:site:*:admin:deployment/*",
];

const siteUrn = (site: string) => `urn:deco:site:*:${site}:deployment/*`;
const isAllowed = (ns: string, jwt: JwtPayload): boolean => {
  const { iss, sub, exp } = jwt;
  if (!iss || !sub) {
    return false;
  }
  if (!trustedIssuers.some(matches(iss.split(":")))) {
    return false;
  }
  if (exp && new Date(exp) <= new Date()) {
    return false;
  }
  const matchWithSite = matches(siteUrn(ns).split(":"));
  return matchWithSite(sub);
};

const ADMIN_PUBLIC_KEY =
  "eyJrdHkiOiJSU0EiLCJhbGciOiJSUzI1NiIsIm4iOiJ0ek92M3hzcGdaNFRWa0RINWZjbjI5b3JLX3Y1QVhodVh0NF9FNVJuREFzZ0xLSkxTZVFRdGwwbW1sVm1oLWlRTkhpQnYtemF1U2FEd0pGaXF1WFJOeFFrXzBiTTZEdWdEQnlaU2wwWmdxRjVkcTVfUXVsVjU4TTMxZHNQX0MxU3pyWmtzMHh4djFTMlU5b25pRmRHRTQxbTkyaWRWMDNKelNXX0xNYkVqMktlYk13UnN4d3lwYWNCdlU2Nkd2Z0l2WXl0bVk1c3l3ZlpXY1EyQk9sdFFsTWVsSzZ0UUFUOFJDR3hqcTNWVUQ1cEJUNElzdFJZTk1WWkJZYnBLc0k1WVJVRVpza3d3VWpGZGs3ZXhweElZbzl2NDIyUVdWd3Exb0NXMEtNakhfS1JXR3dzS3lJa0J3SF9PQWcxQTBNSGFFTkt4c3lHRXMta1haNGV5c0J5QWJJVDM1YWZBc29Jd0lZUTk4WUZTQktndGVsbU9iMUlkT2p4aVhkYzdWaEdBX25vNzVCYUFKUEo2RXdmbGM3N1gtOGs3aS01azJmcVNWemUtaU41SVdwY3g2ejZHdUpKNVhHWGlDeFpWbHBGclJmczdjRktTNm1jcjBUWDJSTUt0NXNEWXVscGw2ZnZaQlEwU1ZFN19NeUJVOWdibFlBVWdta3U2UzRsb2d4Nm44bmpTTm91c2l6amY4NlRaWGljejJiUDBWdHhfVEoxRW5kcEZXcFRuUjExNUJkVWZRVlNfNG9tdVFtam9nN3BaaGRGbmtQRVA4bEU2cUJ1YWpUYXBocDl6VjZFejlLOFh4SHptQWh4OGxGSFA5QjZWV3MzNkxzaUsyU0F5clU4Y0dkbGVobEROSk1UTDdIRnU1ZUd0ZkZzRXFRUVhteFo1YnRuckYwRmpVOCIsImUiOiJBUUFCIiwia2V5X29wcyI6WyJ2ZXJpZnkiXSwiZXh0Ijp0cnVlfQ==";
const jwksIssuer = newJwksIssuer({
  fallbackPublicKey: ADMIN_PUBLIC_KEY,
  remoteAddress: "https://deco.cx/.well_known/jwks.json",
});

export const withAuth = (): MiddlewareHandler<
  Env,
  "/namespaces/:namespace/*",
  {}
> => {
  return async (ctx, next) => {
    const credentials = ctx.req.headers.get("Authorization");

    const unauthorized = () => {
      const res = new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            `Bearer realm="${ctx.req.url}",error="invalid_request",error_description="invalid credentials structure"`,
        },
      });
      return new HTTPException(401, { res });
    };

    if (!credentials) {
      throw unauthorized();
    }

    const parts = credentials.split(/\s+/);

    if (parts.length !== 2) {
      throw unauthorized();
    }
    const token = parts[1];

    const payload = await jwksIssuer.verifyWith<JwtPayload>((key) =>
      verify(token, key)
    );
    const namespace = ctx.req.param("namespace");

    if (
      !isAllowed(namespace, payload)
    ) {
      const res = new Response("Forbbiden", {
        status: 403,
        headers: {
          "WWW-Authenticate":
            `Bearer realm="${ctx.req.url}",error="invalid_request",error_description="token is invalid"`,
        },
      });
      throw new HTTPException(403, { res });
    }

    ctx.set("principal", payload);
    ctx.set("checkIsAllowed", (ref) => {
      const scopes = (payload.scopes ?? []).map((scope) =>
        new URLPattern(scope)
      );
      const url = new URL(ref.url);
      if (!scopes.some((scope) => scope.test(url))) {
        const res = new Response("Forbbiden", {
          status: 403,
          headers: {
            "WWW-Authenticate":
              `Bearer realm="${ctx.req.url}",error="invalid_request",error_description="scopes does not include ${ref.url}"`,
          },
        });
        throw new HTTPException(403, { res });
      }
    });

    return next();
  };
};
