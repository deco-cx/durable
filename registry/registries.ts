// deno-lint-ignore-file no-explicit-any
import { MINUTE } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import { WorkflowContext } from "../context.ts";
import { Workflow } from "../mod.ts";
import { PromiseOrValue } from "../promise.ts";
import { runtimeBuilder } from "../runtime/builders.ts";
import { deno } from "../runtime/deno.ts";
import { http as httpRuntime } from "../runtime/http.ts";
import { Arg } from "../types.ts";
import { setIntervalFlight } from "../utils.ts";

export interface WorkflowRegistry {
  get<
    TArgs extends Arg = Arg,
    TResult = unknown,
    TCtx extends WorkflowContext = WorkflowContext,
  >(
    alias: string,
  ): PromiseOrValue<Workflow<TArgs, TResult, TCtx> | undefined>;
}
export interface WorkflowRuntimeRefBase {
  type: string;
  alias: string;
}
export interface DenoWorkflowRuntimeRef extends WorkflowRuntimeRefBase {
  type: "deno";
  url: string;
}

export interface HttpWorkflowRuntimeRef extends WorkflowRuntimeRefBase {
  type: "http";
  url: string;
}

export type WorkflowRuntimeRef =
  | DenoWorkflowRuntimeRef
  | HttpWorkflowRuntimeRef;

export interface RegistryBase {
  type: string;
}

export interface GithubRegistry extends RegistryBase {
  org: string;
  repo: string;
  defaultBranch?: string;
  path?: string;
  type: "github";
}

export interface HttpRegistry extends RegistryBase {
  type: "http";
  baseUrl: string | ((alias: string) => string);
}

export interface InlineRegistry extends RegistryBase {
  type: "inline";
  ref: WorkflowRuntimeRef;
}

export type Registry = GithubRegistry | HttpRegistry | InlineRegistry;

export type GenericWorkflow = Workflow<any, any, any>;
const inline = ({ ref }: InlineRegistry) => {
  const runtimePromise = runtimeBuilder[ref.type](ref);
  return (_: string) => {
    return runtimePromise;
  };
};
const sanitize = (str: string) => (str.startsWith("/") ? str : `/${str}`);
const http =
  ({ baseUrl }: HttpRegistry) => (alias: string): GenericWorkflow => {
    return httpRuntime({
      url: typeof baseUrl === "function"
        ? baseUrl(alias)
        : `${baseUrl}${sanitize(alias)}`,
    });
  };

const github =
  ({ repo, org, path, defaultBranch }: GithubRegistry) =>
  async (alias: string): Promise<GenericWorkflow> => {
    const [name, ref] = alias.split("@");
    return await deno({
      url: `https://raw.githubusercontent.com/${org}/${repo}/${
        ref ?? defaultBranch ?? "main"
      }${path}/${name}.ts`,
    });
  };

const providers: Record<
  Registry["type"],
  (
    registry: any,
  ) => (alias: string) => PromiseOrValue<GenericWorkflow>
> = {
  http,
  github,
  inline,
};

const buildProvider = (registry: Registry) => {
  return providers[registry.type](registry);
};

const buildAll = (
  registries: Record<string, Registry>,
): Record<string, (alias: string) => PromiseOrValue<GenericWorkflow>> => {
  return Object.keys(registries).reduce(
    (
      result: Record<
        string,
        (alias: string) => PromiseOrValue<GenericWorkflow>
      >,
      key,
    ) => {
      result[key] = buildProvider(registries[key]);
      return result;
    },
    {},
  );
};
const TRUSTED_REGISTRIES = Deno.env.get("TRUSTED_REGISTRIES_URL") ??
  "https://raw.githubusercontent.com/mcandeia/trusted-registries/67cf3bf02979e5801c4c11db6969b1ab34632466/registries.ts";

const fetchTrusted = async (): Promise<
  Record<string, Registry>
> => {
  const registries = await import(TRUSTED_REGISTRIES);

  if (registries?.default === undefined) {
    throw new Error(
      `could not load trusted repositories: ${TRUSTED_REGISTRIES}`,
    );
  }
  return await registries.default();
};

const REBUILD_TRUSTED_INTERVAL_MS = 1 * MINUTE;
export const buildWorkflowRegistry = async () => {
  const trustedRegistries = await fetchTrusted();
  let current = buildAll(trustedRegistries);
  setIntervalFlight(async () => {
    await fetchTrusted().then((trusted) => {
      current = buildAll(trusted);
    });
  }, REBUILD_TRUSTED_INTERVAL_MS);
  return {
    get: async (alias: string) => {
      const [namespace, ...names] = alias.split(".");
      const loadRuntime = namespace.length === 0
        ? current[alias]
        : current[namespace];
      if (loadRuntime === undefined) {
        return undefined;
      }
      return await loadRuntime(names.join("."));
    },
  };
};
