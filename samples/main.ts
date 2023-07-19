import { useWorkflowRoutes } from "../sdk/deno/mod.ts";
import checkout from "./checkout.ts";
import orders from "./orders.ts";
import { router, serve } from "./serve.mjs";

await serve(
  router({
    "*": useWorkflowRoutes({
      baseRoute: "/",
    }, [orders, checkout]),
  }),
  { port: 8000 },
);
