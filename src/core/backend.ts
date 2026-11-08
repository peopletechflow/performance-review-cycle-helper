import type { Caller } from "./identity.js";
import { CapabilityGated, type CapabilityDef, type CapabilityStatus, type Gateway } from "./upstream.js";

/**
 * One interface for both modes so tools have a single code path. Live = Gateway over the
 * upstream Workday MCP server. Fixture = local example handlers, validated with the same
 * output schemas. Live mode never falls back to fixtures.
 */
export interface Backend {
  readonly mode: "fixture" | "live";
  capabilities(): CapabilityStatus[];
  isAvailable(cap: string): boolean;
  invoke<T>(cap: string, input: Record<string, unknown>, caller: Caller): Promise<T>;
  sourceSystem(cap: string): string;
}

export class LiveBackend implements Backend {
  readonly mode = "live" as const;
  constructor(private readonly g: Gateway) {}
  capabilities() { return this.g.capabilities(); }
  isAvailable(cap: string) { return this.g.isAvailable(cap); }
  invoke<T>(cap: string, input: Record<string, unknown>) { return this.g.invoke<T>(cap, input); }
  sourceSystem(cap: string) { return `workday-mcp:${this.g.capabilities().find((x) => x.capability === cap)?.upstreamTool ?? cap}`; }
}

export type FixtureHandler = (input: Record<string, unknown>, caller: Caller) => unknown | Promise<unknown>;
export class FixtureBackend implements Backend {
  readonly mode = "fixture" as const;
  constructor(private readonly defs: Record<string, CapabilityDef>, private readonly handlers: Record<string, FixtureHandler>, private readonly gated: readonly string[] = []) {}
  capabilities(): CapabilityStatus[] { return Object.entries(this.defs).map(([c, d]) => ({ capability: c, kind: d.kind, status: this.isAvailable(c) ? "available" : "gated", reason: this.isAvailable(c) ? "fixture (example data)" : "disabled in fixture" })); }
  isAvailable(cap: string) { return Boolean(this.handlers[cap]) && !this.gated.includes(cap); }
  async invoke<T>(cap: string, input: Record<string, unknown>, caller: Caller): Promise<T> {
    if (!this.isAvailable(cap)) throw new CapabilityGated(cap, "disabled in fixture");
    return this.defs[cap].output.parse(await this.handlers[cap](input, caller)) as T;
  }
  sourceSystem(cap: string) { return `fixture:${cap}`; }
}
