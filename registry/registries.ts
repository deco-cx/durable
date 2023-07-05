// deno-lint-ignore-file no-explicit-any
import { MINUTE } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import { WorkflowContext } from "../context.ts";
import { Workflow } from "../mod.ts";
import { PromiseOrValue } from "../promise.ts";
import { runtimeBuilder } from "../runtime/builders.ts";
import { deno } from "../runtime/deno.ts";
import { http as httpRuntime } from "../runtime/http.ts";
import { websocket as websocketRuntime } from "../runtime/websocket.ts";
import { verifySignature } from "../security/identity.ts";
import { parseJWK } from "../security/keys.ts";
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
  verifySignature: (alias: string, req: Request) => Promise<void>;
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

export interface WebSocketWorkflowRuntimeRef extends WorkflowRuntimeRefBase {
  type: "websocket";
  url: string;
}

export type WorkflowRuntimeRef =
  | DenoWorkflowRuntimeRef
  | HttpWorkflowRuntimeRef
  | WebSocketWorkflowRuntimeRef;

export interface RegistryBase {
  type: string;
  publicKey?: string;
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

export interface WebSocketRegistry extends RegistryBase {
  type: "websocket";
  baseUrl: string | ((alias: string) => string);
}

export interface InlineRegistry extends RegistryBase {
  type: "inline";
  ref: WorkflowRuntimeRef;
}

export type Registry =
  | GithubRegistry
  | HttpRegistry
  | InlineRegistry
  | WebSocketRegistry;

export type GenericWorkflow = Workflow<any, any, any>;
export type WorkflowInfo = {
  creator: (alias: string) => PromiseOrValue<GenericWorkflow>;
  publicKey?: string;
};
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

const websocket =
  ({ baseUrl }: HttpRegistry) => (alias: string): GenericWorkflow => {
    return websocketRuntime({
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
  websocket,
};

const buildProvider = (registry: Registry) => {
  return providers[registry.type](registry);
};

const buildAll = (
  registries: Record<string, Registry>,
): Record<string, WorkflowInfo> => {
  return Object.keys(registries).reduce(
    (
      result: Record<
        string,
        WorkflowInfo
      >,
      key,
    ) => {
      const workflow = registries[key];
      result[key] = {
        creator: buildProvider(workflow),
        publicKey: workflow.publicKey,
      };
      return result;
    },
    {},
  );
};
const TRUSTED_REGISTRIES = Deno.env.get("TRUSTED_REGISTRIES_URL") ??
  "https://raw.githubusercontent.com/mcandeia/trusted-registries/c1e1126cc4d7b5682928eb2cfd804315ed31804f/registries.ts";

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
export const buildWorkflowRegistry = async (): Promise<WorkflowRegistry> => {
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
      return await loadRuntime.creator(names.join("."));
    },
    verifySignature: async (alias: string, req: Request) => {
      const [namespace] = alias.split(".");
      const loadRuntime = namespace.length === 0
        ? current[alias]
        : current[namespace];
      if (!loadRuntime.publicKey) {
        return;
      }
      await verifySignature(req, parseJWK(loadRuntime.publicKey!));
    },
  };
};
