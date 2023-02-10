import { serve } from "https://deno.land/std@0.173.0/http/server.ts";
import { router } from "https://deno.land/x/rutt@0.0.14/mod.ts";
import { useWorkflowRoutes } from "../mod.ts";
import createOrder from "./createOrder.ts";

await serve(
  router({
    "*": useWorkflowRoutes({
      baseRoute: "/",
    }, [createOrder]),
  }),
  { port: 8002 },
);
