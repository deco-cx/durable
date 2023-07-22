import { WorkflowContext } from "../context.ts";
import { OrderForm } from "./checkout.ts";

export interface Sku {
  name: string;
  price: number;
}

export interface Order {
  id: string;
  skus: Sku[];
  total: number;
}
export const Catalog: Record<string, Sku> = {
  "1": {
    name: "Shampoo",
    price: 10,
  },
  "2": {
    name: "Soap",
    price: 5.5,
  },
  "3": {
    name: "Helmet",
    price: 1000,
  },
};
export default function* orders(
  ctx: WorkflowContext<{ parentWorkflowId: string }>,
  { skuIds }: OrderForm,
) {
  const skus: Sku[] = [];
  let total = 0;
  for (const skuId of skuIds) {
    const sku = Catalog[skuId];
    if (sku === undefined) {
      return {
        error: `Sku ${skuId} not found`,
      };
    }
    total += sku.price;
    skus.push(sku);
  }

  yield ctx.log("Pretending some delay");
  const result: { message: string } | undefined = yield ctx.waitAny([
    ctx.sleep(15000),
    ctx.waitForSignal("lets_go"),
  ]); // pretending some delay.
  yield ctx.log("received message", result?.message);
  yield ctx.log("Returning back to the execution");
  const order: Order = yield ctx.callLocalActivity(() => {
    return ({
      id: crypto.randomUUID(),
      skus,
      total,
    });
  });
  yield ctx.fetch(
    `http://localhost:8001/namespaces/x/executions/${ctx.metadata?.parentWorkflowId}/signals/order_created`,
    { method: "POST", body: JSON.stringify(order) },
  );
  return order;
}
