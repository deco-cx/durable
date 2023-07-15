// deno-lint-ignore-file no-explicit-any
import type {
  ConnInfo,
  Handler,
} from "https://deno.land/std@0.173.0/http/server.ts";
import { Metadata } from "../../context.ts";
import { PromiseOrValue } from "../../promise.ts";
import { Command } from "../../runtime/core/commands.ts";
import { Workflow } from "../../runtime/core/workflow.ts";
import { verifySignature } from "../../security/identity.ts";
import { Arg } from "../../types.ts";
import { asVerifiedChannel, Channel, WorkflowContext } from "./mod.ts";

export interface WebSocketRunRequest<
  TArgs extends Arg = Arg,
  TMetadata extends Metadata = Metadata,
> {
  input: [...TArgs];
  executionId: string;
  metadata: TMetadata;
}

export const isWebSocketRunReq = <
  TArgs extends Arg = Arg,
  TMetadata extends Metadata = Metadata,
>(
  value: unknown | WebSocketRunRequest<TArgs, TMetadata>,
): value is WebSocketRunRequest<TArgs, TMetadata> => {
  return Array.isArray((value as WebSocketRunRequest)?.input) &&
    typeof (value as WebSocketRunRequest).executionId === "string";
};

export interface HttpRunRequest<
  TArgs extends Arg = Arg,
  TMetadata extends Metadata = Metadata,
> {
  input: [...TArgs];
  results: unknown[];
  executionId: string;
  metadata: TMetadata;
}

export interface RunRequest<
  TArgs extends Arg = Arg,
  TMetadata extends Metadata = Metadata,
> {
  input: [...TArgs];
  commands: CommandStream;
  executionId: string;
  metadata: TMetadata;
}

export const arrToStream = (
  arr: unknown[],
): CommandStream & { nextCommand: () => Command } => {
  let current = 0;
  let nextCommand: Command = undefined!;
  return {
    issue: (_cmd: Command) => {
      if (current === arr.length) {
        nextCommand = _cmd;
        return Promise.resolve({ isClosed: true });
      }
      return Promise.resolve(arr[current++]);
    },
    nextCommand: () => nextCommand,
  };
};

/**
 * Exposes a workflow function as a runner.
 * @param workflow the workflow function
 * @returns the workflow runner
 */
export const workflowRemoteRunner = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
  TMetadata extends Metadata = Metadata,
>(
  workflow: Workflow<TArgs, TResult, TCtx>,
  Context: new (executionId: string, metadata?: TMetadata) => TCtx,
): (req: RunRequest<TArgs, TMetadata>) => Promise<void> => {
  return async function (
    { commands, input, executionId, metadata }: RunRequest<
      TArgs,
      TMetadata
    >,
  ) {
    const ctx = new Context(executionId, metadata);

    const genFn = workflow(ctx, ...input);
    let cmd = genFn.next();
    while (!cmd.done) {
      const event = await commands.issue(cmd.value);
      if ((event as { isClosed: true })?.isClosed) {
        return;
      }
      cmd = genFn.next(event);
    }

    if (cmd.done) {
      await commands.issue({ name: "finish_workflow", result: cmd.value });
    }
  };
};

/**
 * Exposes a workflow function as a http handler.
 * @param workflow the workflow function
 * @returns a http handler
 */
export const workflowHTTPHandler = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
  TMetadata extends Metadata = Metadata,
>(
  workflow: Workflow<TArgs, TResult, TCtx>,
  Context: new (executionId: string, metadata?: TMetadata) => TCtx,
  workerPublicKey?: JsonWebKey,
): Handler => {
  const runner = workflowRemoteRunner(workflow, Context);
  return async function (req) {
    if (workerPublicKey) {
      verifySignature(req, workerPublicKey);
    }
    const runReq = await req
      .json() as HttpRunRequest<TArgs, TMetadata>;

    const stream = arrToStream(runReq.results);
    await runner({ ...runReq, commands: stream });
    return Response.json(
      stream.nextCommand(),
    );
  };
};

export interface CreateRouteOptions {
  baseRoute: string;
}

export interface AliasedWorkflow {
  alias: string;
  func: Workflow<any, any, any>;
}

const isAlisedWorkflow = (
  wkflow: AliasedWorkflow | Workflow<any, any, any>,
): wkflow is AliasedWorkflow => {
  return (wkflow as AliasedWorkflow).alias !== undefined;
};
export type Workflows = Array<Workflow<any, any, any> | AliasedWorkflow>;

export const useWorkflowRoutes = (
  { baseRoute }: CreateRouteOptions,
  workflows: Workflows,
): Handler => {
  const routes: Record<string, Handler> = {};
  for (const wkflow of workflows) {
    const { alias, func } = isAlisedWorkflow(wkflow)
      ? wkflow
      : { alias: wkflow.name, func: wkflow };
    const route = `${baseRoute}${alias}`;
    routes[route] = workflowHTTPHandler(func, WorkflowContext);
  }
  return (req: Request, conn: ConnInfo) => {
    const url = new URL(req.url);
    const handler = routes[url.pathname];
    if (!handler) {
      return new Response(null, { status: 404 });
    }
    return handler(req, conn);
  };
};

export interface CommandStream {
  issue: (cmd: Command) => Promise<unknown | { isClosed: true }>;
}
const useChannel =
  <TArgs extends Arg = Arg, TMetadata extends Metadata = Metadata>(
    runner: (req: RunRequest<TArgs, TMetadata>) => Promise<void>,
  ) =>
  async (chan: Channel<Command, unknown | WebSocketRunRequest>) => {
    const runReq = await chan.recv();
    if (!isWebSocketRunReq<TArgs, TMetadata>(runReq)) {
      throw new Error(`received unexpected message ${JSON.stringify(runReq)}`);
    }
    const commands: CommandStream = {
      issue: async (cmd: Command) => {
        const closed = await Promise.race([chan.closed.wait(), chan.send(cmd)]);
        if (closed === true) {
          return { isClosed: true };
        }
        const event = await Promise.race([chan.recv(), chan.closed.wait()]);
        if (event === true) {
          return { isClosed: true };
        }
        return event;
      },
    };
    await runner({ ...runReq, commands });
  };
/**
 * Exposes a workflow function as a http websocket handler.
 * @param workflow the workflow function
 * @returns a http handler
 */
export const workflowWebSocketHandler = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
  TMetadata extends Metadata = Metadata,
>(
  workflow: Workflow<TArgs, TResult, TCtx>,
  Context: new (executionId: string, metadata?: TMetadata) => TCtx,
  workerPublicKey: PromiseOrValue<JsonWebKey>,
): Handler => {
  const runner = workflowRemoteRunner<TArgs, TResult, TCtx, TMetadata>(
    workflow,
    Context,
  );
  return function (req) {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 501 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);

    asVerifiedChannel<Command, unknown>(
      socket,
      workerPublicKey,
    ).then(useChannel(runner)).catch((err) => {
      console.log("socket err", err);
      socket.close();
    });

    return response;
  };
};
