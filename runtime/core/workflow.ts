import { Command } from "./commands.ts";
import { WorkflowContext } from "../../context.ts";
import { Arg } from "../../types.ts";

/**
 * WorkflowGen is the generator function returned by a workflow function.
 */
export type WorkflowGen<TResp extends unknown = unknown> = Generator<
  Command,
  TResp | undefined,
  // deno-lint-ignore no-explicit-any
  any
>;

/**
 * WorkflowGenFn is a function that returns a workflow generator function.
 */
export type WorkflowGenFn<
  TArgs extends Arg = Arg,
  TResp extends unknown = unknown,
> = (...args: [...TArgs]) => WorkflowGen<TResp>;

export type NoArgWorkflowFn<TResp = unknown> = () => WorkflowGen<TResp>;

/**
 * a typeguard for checking if the workflow function requires arguments.
 */
export const isNoArgFn = function <TArgs extends Arg = Arg, TResp = unknown>(
  fn: WorkflowGenFn<TArgs, TResp>,
): fn is NoArgWorkflowFn<TResp> {
  return fn.length == 0;
};

export type Workflow<TArgs extends Arg = Arg, TResp = unknown> = (
  ctx: WorkflowContext,
  ...args: [...TArgs]
) => WorkflowGen<TResp>;
