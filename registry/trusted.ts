export default function () {
  return Promise.resolve({
    "deco-sites": {
      publicKey:
        "eyJrdHkiOiJSU0EiLCJhbGciOiJSUzI1NiIsIm4iOiJ0NEhaYzZHU0pYTzRVR0Z0VmlLWjVTUTVaT0p6QzUyaFdWU1hqX05EUDVoSE1JX2VZb18zSVBTT3c3eUpFZjAwZ3J2X2VBN2x2UGpyR2xzakpwQ1d1WnY2b1JMRkdvQm9QUzlwMjFfWmtvQ1hBMTFBb2ZsWWVTQ0xWc1RTZ2RyWVVoYkFfWHNienhUdEd5b0xlaWo4Q2dxNVFhUVd4N20zazJ4SEsySlJsazktTlI1RVNwWG96NS1EU2hhdWlOdG9GZHdDYlQ2bHdoZ04xOVFXdklOdjJpU0FKdnZpTWZZWGpPZFUxdU9LX3J3bGMtX2pUd0FNZTRHUXE0T3ZOaHR2dktpRWFGYTNLOFlUS0NnRWpGLUpiT1Q0LVV2Y3JaUzdnWFlzTks5TU1ISHp5bHZWSjItMWRqazUyclluTWNCNkdHcnUtc2prM1lQcmtOaXA5cnQwdXciLCJlIjoiQVFBQiIsImtleV9vcHMiOlsidmVyaWZ5Il0sImV4dCI6dHJ1ZX0=",
      type: "websocket",
      baseUrl: (alias: string) => {
        const [deployment, ...urls] = alias.split(
          "@",
        );
        return `wss://deco-sites-${deployment}.deno.dev${urls.join("@")}`;
      }, // `deco-sites.name-deployment@/url
    },
    "local": {
      type: "http",
      baseUrl: "http://localhost:8000",
    },
    "local-socket": {
      type: "websocket",
      baseUrl: "ws://localhost:8000",
    },
    "deco": {
      org: "deco-sites",
      repo: "deco",
      type: "github",
    },
    "fashion": {
      org: "deco-sites",
      repo: "fashion",
      path: "/workflows",
      type: "github",
    },
    "mcandeia": {
      org: "mcandeia",
      repo: "/workflows",
      type: "github",
    },
  });
}
