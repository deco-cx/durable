import { init, start, useWorkflowRoutes } from "../sdk/deno/mod.ts";
import checkout from "./checkout.ts";
import orders from "./orders.ts";
import { router, serve } from "./serve.mjs";

init({
  durableEndpoint: "http://localhost:8001",
  namespace: "x",
  audience: `urn:deco:site::samples:`,
  token:
    "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ1cm46ZGVjbzpzaXRlOjphZG1pbjpkZXBsb3ltZW50L3RzdCIsInN1YiI6InVybjpkZWNvOnNpdGU6Ong6ZGVwbG95bWVudC90c3QiLCJzY29wZXMiOlsiaHR0cDovL2xvY2FsaG9zdDo4MDAwLyoiXX0.ItNDHNLRJ-IrCSVuqywuJ2xuO3o83XmokrSCwTbEhB3DbUrxFTq3bXZw-6CsnS4EeN4sEUkIA5a4tAqbwz3Q9Qf4-1o7JSlGViLLo1Vm88QNN3kaeR6YIi69ZSm23C7NOpv9gOvSTgyY3snSMPD3eXgCfiE3hvE86B4nWicbDaRzPq20m-6PaCQqTw97VQtFqDWMVczDXpGGYY9-koDO5qbOfOQad0zt4n0q1iOlULvWaEqJDspOydKWkbwYIut5F13OPnadxJpwgVF_4e3ehtLB5T6cZJp15uoE0wi0WRepS_AzrisRE1mDMhlK9ArXnU-LEk68M1-Rha06xNq4Yw",
});

await serve(
  router({
    "/start": async () => {
      const execution = await start({
        namespace: "x",
        workflow: {
          type: "http",
          url: "http://localhost:8000/checkout",
        },
        input: [
          {
            skuIds: [
              "1",
              "2",
              "3",
            ],
          },
        ],
      });
      return Response.json(execution, { status: 201 });
    },
    "*": useWorkflowRoutes({
      baseRoute: "/",
    }, [orders, checkout]),
  }),
  { port: 8000 },
);
