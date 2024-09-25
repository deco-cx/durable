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
    namespace: string;
  }
}

const matchPart = (urnPart: string, otherUrnPart: string) =>
  urnPart === "*" || otherUrnPart === urnPart;
const matchParts = (urn: string[], resource: string[]) => {
  return urn.every((part, idx) => matchPart(part, resource[idx]));
};
const matches = (urnParts: string[]) => (resourceUrn: string) => {
  const resourceParts = resourceUrn
    .split(":");
  const lastIdx = resourceParts.length - 1;
  return resourceParts.every((part, idx) => {
    if (part === "*") {
      return true;
    }
    if (lastIdx === idx) {
      return matchParts(part.split("/"), urnParts[idx].split("/"));
    }
    return part === urnParts[idx];
  });
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
  const matchWithSite = matches(sub.split(":"));
  return matchWithSite(siteUrn(ns));
};

const ADMIN_PUBLIC_KEY =
  "eyJrdHkiOiJSU0EiLCJhbGciOiJSUzI1NiIsIm4iOiJ1N0Y3UklDN19Zc3ljTFhEYlBvQ1pUQnM2elZ6VjVPWkhXQ0M4akFZeFdPUnByem9WNDJDQ1JBVkVOVjJldzk1MnJOX2FTMmR3WDlmVGRvdk9zWl9jX2RVRXctdGlPN3hJLXd0YkxsanNUbUhoNFpiYXU0aUVoa0o1VGNHc2VaelhFYXNOSEhHdUo4SzY3WHluRHJSX0h4Ym9kQ2YxNFFJTmc5QnJjT3FNQmQyMUl4eUctVVhQampBTnRDTlNici1rXzFKeTZxNmtPeVJ1ZmV2Mjl0djA4Ykh5WDJQenp5Tnp3RWpjY0lROWpmSFdMN0JXX2tzdFpOOXU3TUtSLWJ4bjlSM0FKMEpZTHdXR3VnZGpNdVpBRnk0dm5BUXZzTk5Cd3p2YnFzMnZNd0dDTnF1ZE1tVmFudlNzQTJKYkE3Q0JoazI5TkRFTXRtUS1wbmo1cUlYSlEiLCJlIjoiQVFBQiIsImtleV9vcHMiOlsidmVyaWZ5Il0sImV4dCI6dHJ1ZX0=";
const jwksIssuer = newJwksIssuer({
  fallbackPublicKey: ADMIN_PUBLIC_KEY,
  remoteAddress: "https://deco.cx/.well_known/jwks.json",
});

export const withAuth = (): MiddlewareHandler<
  Env,
  "/namespaces/:namespace/*",
  // deno-lint-ignore ban-types
  {}
> => {
  return async (ctx, next) => {
    const credentials = ctx.req.header("Authorization") ??
      "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ1cm46ZGVjbzpzaXRlOjphZG1pbjpkZXBsb3ltZW50L3RzdCIsInN1YiI6InVybjpkZWNvOnNpdGU6Ong6ZGVwbG95bWVudC90c3QiLCJzY29wZXMiOlsiaHR0cDovL2xvY2FsaG9zdDo4MDAwLyoiLCJ3czovL2xvY2FsaG9zdDo4MDAwLyoiXX0.awdXDppwF-Dn7BwMWLz3hHqlx16HfVBuPuoGP4mVBihkMxwqDvZYWi_1Dg27u6ajg9br9qL6xSTlN8nauo89AyELaQavUIPDnW5u1yZpVZ5XE1C7DyVc3ncGe8L_PjuRqkfkc24POCiPVALYqKpJ7uERkjoSSRT5BBbuPvuWYZQaeNpkw6CUKWzod9myg7evtbIBEuLHnNyhT2hKmdzLuJNzakS-cyZVIQ6Pm_JDTQhdH15QyDNviJ6tM6HrNARgti40QUOAwRpACLZ16LsEpAitaZPBx7KNDr456indBP_HqZF6crO3yUQEFSN5Yb323VLjtaX2SVSqIP0uOLn0yA";

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
    ).catch((err) => {
      console.log("error", err);
      throw unauthorized();
    });

    const namespace = ctx.req.param("namespace");
    ctx.set("namespace", namespace);

    if (
      !isAllowed(namespace, payload)
    ) {
      console.warn(`${credentials} is invalid`);
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
      if (!ref?.url) {
        return;
      }
      const scopes = (payload.scopes ?? []).map((scope) =>
        new URLPattern(scope)
      );
      const url = new URL(ref.url);
      url.search = "";
      const atLeastOneIsAllowed = scopes.some((scope) => scope.test(url));
      if (!atLeastOneIsAllowed) {
        console.warn(`${credentials} scope not allowed.`);
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
