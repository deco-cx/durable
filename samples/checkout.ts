import { WorkflowContext } from "../context.ts";
import { Order } from "./orders.ts";

export interface OrderForm {
  skuIds: string[];
}

export default function* checkout(
  ctx: WorkflowContext,
  orderForm: OrderForm,
) {
  yield ctx.log("Starting checkout");
  try {
    const { id } = yield ctx.startExecution({
      workflow: {
        type: "http",
        url: "http://localhost:8000/orders",
      },
      metadata: {
        parentWorkflowId: ctx.execution.id,
      },
      input: [orderForm],
    });
    yield ctx.log("Created order workflow of", id);

    const order: Order = yield ctx.waitForSignal("order_created");
    yield ctx.log("Received created order", order);
    return order;
  } catch (err) {
    return { error: err };
  }
}
