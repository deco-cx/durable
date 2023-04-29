// deno-lint-ignore-file no-explicit-any
import { Handler } from "https://deno.land/std@0.173.0/http/server.ts";
import { router, Routes } from "https://deno.land/x/rutt@0.0.14/mod.ts";
import { WorkflowContext } from "./mod.ts";
import { Workflow } from "./runtime/core/workflow.ts";
import { Arg } from "./types.ts";

export interface RunRequest<TArgs extends Arg = Arg> {
  results: [[...TArgs], unknown];
  executionId: string;
}

/**
 * Exposes a workflow function as a http handler.
 * @param workflow the workflow function
 * @returns a http handler
 */
export const workflowHTTPHandler = <
  TArgs extends Arg = Arg,
  TResult = unknown,
  TCtx extends WorkflowContext = WorkflowContext,
>(
  workflow: Workflow<TArgs, TResult, TCtx>,
  Context: new (executionId: string) => TCtx,
): Handler => {
  return async function (req) {
    const { results: [input, ...results], executionId } = await req
      .json() as RunRequest<TArgs>;
    const ctx = new Context(executionId);

    const genFn = workflow(ctx, ...input);
    let cmd = genFn.next();
    for (const result of results) {
      if (cmd.done) {
        break;
      }
      cmd = genFn.next(result);
    }

    if (cmd.done) {
      return Response.json({ name: "finish_workflow", result: cmd.value });
    }

    return Response.json(cmd.value);
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
  let routes: Routes = {};
  for (const wkflow of workflows) {
    const { alias, func } = isAlisedWorkflow(wkflow)
      ? wkflow
      : { alias: wkflow.name, func: wkflow };
    const route = `${baseRoute}${alias}`;
    routes = {
      ...routes,
      [`POST@${route}`]: workflowHTTPHandler(func, WorkflowContext),
    };
  }
  return router(routes);
};
