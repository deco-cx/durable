import { WorkflowContext } from "../context.ts";

// any activity
function plsSum(a: number, b: number): number {
  return a + b;
}

// workflow definition
const sumWithDelayWorkflow = function* (ctx: WorkflowContext) {
  const resp: number = yield ctx.callLocalActivity(() => plsSum(20, 30));
  yield ctx.sleep(5000);
  const resp2: number = yield ctx.callLocalActivity(() => plsSum(20, 30));
  return resp + resp2;
};
// create order workflow
interface OrderForm {
  items: string[];
}
interface Order extends OrderForm {
  id: string;
}

export default function* createOrder(
  ctx: WorkflowContext,
  _orderForm: OrderForm,
) {
  yield* sumWithDelayWorkflow(ctx);
  const orderCreated: Order = yield ctx.waitForSignal("order_created");
  return { id: orderCreated.id };
}
