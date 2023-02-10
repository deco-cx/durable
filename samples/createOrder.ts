import { WorkflowContext } from "../context.ts";
import { delay } from "https://deno.land/std@0.160.0/async/delay.ts";

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
async function _createOrderVtex(form: OrderForm): Promise<void> {
  console.log("Received orderForm", form);
  await delay(5000); // faking some delay
}

export default function* createOrder(
  ctx: WorkflowContext,
  _orderForm: OrderForm,
) {
  //yield ctx.callActivity(createOrderVtex, orderForm);
  yield* sumWithDelayWorkflow(ctx);
  const orderCreated: Order = yield ctx.waitForSignal("order_created");
  return orderCreated.id;
}
