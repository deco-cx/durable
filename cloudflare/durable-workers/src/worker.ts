import { getRouter } from "../../../api/main.ts";
import { dbForEnv } from "../../../backends/durableObjects/connect.ts";
import { buildWorkflowRegistry } from "../../../registry/registries.ts";
import { HistoryEvent } from "../../../runtime/core/events.ts";
export { Workflow } from "./workflow.ts";

export type Queue<T> = any;
export type MessageBatch<T> = any;
export type DurableObjectNamespace = any;
export interface ExecutionEvent {
  executionId: string;
  origin: string;
  payload: { events: HistoryEvent[] };
}
export interface Env {
  EVENTS: Queue<ExecutionEvent>;
  WORKFLOWS: DurableObjectNamespace;
}

const registry = await buildWorkflowRegistry();
export default {
  // Our fetch handler is invoked on a HTTP request: we can send a message to a queue
  // during (or after) a request.
  // https://developers.cloudflare.com/queues/platform/javascript-apis/#producer
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(req.url);
    const db = dbForEnv(env, url.origin);
    const router = await getRouter(db, registry);
    return router.fetch(req, env, ctx);
  },
  // The queue handler is invoked when a batch of messages is ready to be delivered
  // https://developers.cloudflare.com/queues/platform/javascript-apis/#messagebatch
  async queue(batch: MessageBatch<ExecutionEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const db = dbForEnv(env, message.body.origin);
      try {
        await db.execution(message.body.executionId).pending.add(
          ...message.body.payload.events,
        );
        message.ack();
      } catch (err) {
        console.error("error when sending batch", err);
        message.retry();
      }
    }
  },
};
