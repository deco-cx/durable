// deno-lint-ignore-file no-explicit-any
import type {
  ConnInfo,
  Handler,
} from "https://deno.land/std@0.173.0/http/server.ts";
import { defaultOpts } from "../../client/init.ts";
import { Metadata } from "../../context.ts";
import { verify } from "../../djwt.js";
import { Command, runLocalActivity } from "../../runtime/core/commands.ts";
import { Workflow } from "../../runtime/core/workflow.ts";
import { newJwksIssuer } from "../../security/jwks.ts";
import { Arg } from "../../types.ts";
import type { ClientOptions, JwtPayload } from "./mod.ts";
import {
  asChannel,
  Channel,
  LocalActivityCommand,
  WorkflowContext,
  WorkflowExecution,
} from "./mod.ts";

const isValid = ({ exp, aud }: JwtPayload, audience?: string) => {
  if (exp) {
    return new Date(exp) >= new Date();
  }
  if (!audience) {
    return true;
  }
  if (!aud) {
    return false;
  }
  return Array.isArray(aud)
    ? aud.some((d) => d === audience)
    : aud === audience;
};

export interface WebSocketRunRequest<
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
> {
  input: [...TArgs];
  execution: WorkflowExecution<TArgs, TResult, TMetadata>;
}

export const isWebSocketRunReq = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
>(
  value: unknown | WebSocketRunRequest<TArgs, TResult, TMetadata>,
): value is WebSocketRunRequest<TArgs, TResult, TMetadata> => {
  return Array.isArray((value as WebSocketRunRequest)?.input) &&
    typeof (value as WebSocketRunRequest).execution?.id === "string";
};

export interface HttpRunRequest<
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
> {
  input: [...TArgs];
  results: unknown[];
  execution: WorkflowExecution<TArgs, TResult, TMetadata>;
}

export interface RunRequest<
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
> {
  input: [...TArgs];
  commands: CommandStream;
  execution: WorkflowExecution<TArgs, TResult, TMetadata>;
}

export const arrToStream = (
  arr: unknown[],
): CommandStream & { nextCommand: () => Promise<Command> } => {
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
    nextCommand: () => runLocalActivity(nextCommand),
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
  Context: (
    execution: WorkflowExecution<TArgs, TResult, TMetadata>,
  ) => TCtx,
): (req: RunRequest<TArgs, TResult, TMetadata>) => Promise<void> => {
  return async function (
    { commands, input, execution }: RunRequest<
      TArgs,
      TResult,
      TMetadata
    >,
  ) {
    const ctx = Context(execution);

    const genFn = await workflow(ctx, ...input);
    let cmd = genFn.next();
    while (!cmd.done) {
      const event = await commands.issue(cmd.value);
      if ((event as { isException: true; error: any })?.isException) {
        try {
          cmd = genFn.throw((event as { error: any }).error);
        } catch (e) {
          await commands.issue({ name: "finish_workflow", exception: e });
          return;
        }
        continue;
      }
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

const initializeAuthority = (opts?: ClientOptions | null) => {
  return opts
    ? newJwksIssuer({
      remoteAddress: opts.durableEndpoint
        ? `${opts.durableEndpoint}/.well_known/jwks.json`
        : "https://durable-workers.deco-cx.workers.dev/.well_known/jwks.json",
      kid: "durable-workers-key",
      fallbackPublicKey: opts.publicKey ??
        "93u8uEX6gXEST9iKjA2rJ5BquUgHOBCS80EGALCIwGpnuCt6bvE2cQ19iPSvXQ4Ahq2GM1LiaLtIqk2ZLYzdheUDfB4fWUBgxTHPkRX_J84WM11z3meGP7jO8F_mnEqbzyzcjoFyagAqjW6TzVvSmcLWvmUE386coDaUcA6MFEtfsfAA5j1YTNYadvoWpeg4E-R1k0LaBmnngWv3H4AIwKjm23zcRQYJ2LrA1bI3qMMU0qyHLOJ2Ag_Ct1t6OsZmL55yojw6rej4ZFqDlAXYMW9_HHfnMbzx4_RFLHBdcqoJJnmvQraqxSxczMlA8-f4QUOc1q7sq4vzpILmQM9Nw",
    })
    : undefined;
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
  Context: (
    execution: WorkflowExecution<TArgs, TResult, TMetadata>,
  ) => TCtx,
): Handler => {
  const authority = initializeAuthority(defaultOpts);
  const runner = workflowRemoteRunner(workflow, Context);
  return async function (req) {
    if (authority) {
      const authorization = req.headers.get("Authorization");
      if (!authorization) {
        return new Response(null, { status: 401 });
      }
      const [_, token] = authorization.split(" ");
      const jwtPayload: JwtPayload = await authority.verifyWith((key) =>
        verify(token, key)
      );
      if (!isValid(jwtPayload, defaultOpts?.audience)) {
        return new Response(null, { status: 403 });
      }
    }
    const runReq = await req
      .json() as HttpRunRequest<TArgs, TResult, TMetadata>;

    const stream = arrToStream(runReq.results);
    await runner({ ...runReq, commands: stream });
    return Response.json(
      await stream.nextCommand(),
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
    routes[route] = workflowHTTPHandler(
      func,
      (execution) => new WorkflowContext(execution),
    );
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

const useChannel = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TMetadata extends Metadata = Metadata,
>(
  runner: (req: RunRequest<TArgs, TResult, TMetadata>) => Promise<void>,
) =>
async (chan: Channel<Command, unknown | WebSocketRunRequest>) => {
  const runReq = await chan.recv();
  if (!isWebSocketRunReq<TArgs, TResult, TMetadata>(runReq)) {
    throw new Error(`received unexpected message ${JSON.stringify(runReq)}`);
  }
  const recvEvent = async (cmd: Command) => {
    const closed = await Promise.race([chan.closed.wait(), chan.send(cmd)]);
    if (closed === true) {
      return { isClosed: true };
    }
    const event = await Promise.race([chan.recv(), chan.closed.wait()]);
    if (event === true) {
      return { isClosed: true };
    }
    return event;
  };
  const commands: CommandStream = {
    issue: async (cmd: Command) => {
      const event = await recvEvent(cmd);
      if ((event as LocalActivityCommand)?.name === "local_activity") { // the server should send the command back to allow it to run.
        return recvEvent(await runLocalActivity(cmd));
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
  Context: (
    execution: WorkflowExecution<TArgs, TResult, TMetadata>,
  ) => TCtx,
): Handler => {
  const authority = initializeAuthority(defaultOpts);
  const runner = workflowRemoteRunner<TArgs, TResult, TCtx, TMetadata>(
    workflow,
    Context,
  );
  return async function (req) {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 501 });
    }
    if (authority) {
      const token = new URL(req.url).searchParams.get("token");
      if (!token) {
        return new Response(null, { status: 401 });
      }
      const jwtPayload: JwtPayload = await authority.verifyWith((key) =>
        verify(token, key)
      ); // TODO(mcandeia) validate EXP and Audience
      if (!isValid(jwtPayload, defaultOpts?.audience)) {
        return new Response(null, { status: 403 });
      }
    }
    const { socket, response } = Deno.upgradeWebSocket(req);

    asChannel<Command, unknown>(socket).then(useChannel(runner)).catch(
      (err) => {
        console.log("socket err", err);
        socket.close();
      },
    );

    return response;
  };
};
