# Explaining

The workflow is located at `./createOrder.ts` the `default` export is a function
that yields commands to run.

```ts
export default function* createOrder(
  ctx: WorkflowContext,
  _orderForm: OrderForm,
) {
  yield* sumWithDelayWorkflow(ctx);
  const orderCreated: Order = yield ctx.waitForSignal("order_created");
  return { id: orderCreated.id };
}
```

The workflow receives an `OrderForm` as a input and then it calls a nested
workflow called `sumWithDelayWorkflow` see below:

```ts
// workflow definition
const sumWithDelayWorkflow = function* (ctx: WorkflowContext) {
  const resp: number = yield ctx.callLocalActivity(() => plsSum(20, 30));
  yield ctx.sleep(5000);
  const resp2: number = yield ctx.callLocalActivity(() => plsSum(20, 30));
  return resp + resp2;
};
```

This workflow basically consists of a local activity (which is basically a
function invocation inline), then it sleeps 5s, which means that the code will
actually stop to run until the desired time is reached, to prove that you can
kill the workflow process and run it again before completing 5s. After that, we
return back to the original workflow and then it waits for a signal to be raised
`yield ctx.waitForSignal("order_created");` which will eventually be triggered
by an external action and this action will carry the created order.

# Running

First, start the workflow server

1. On the root folder run: `npm start` (the storage is backed by `sqlite` by
   default and a `test.db` will be created in the root directory of this
   repository, delete it in case of a unrecoverable error)
2. On the samples folder run: `deno run -A main.ts`

Start the workflow using the following command

```sh
curl --location 'http://localhost:8001/namespaces/x/executions' \
--header 'Content-Type: application/json' \
--data '{
    "workflow": {
        "type": "http",
        "url": "http://localhost:8000/checkout"
    },
    "input": [
        {
            "skuIds": [
                "1",
                "2",
                "3"
            ]
        }
    ]
}'
```

You can get the event history by running the following command,

```sh
curl --location 'http://localhost:8001/executions/$ID/history'
```

And the workflow result by running

```sh
curl --location 'http://localhost:8001/executions/$ID'
```
