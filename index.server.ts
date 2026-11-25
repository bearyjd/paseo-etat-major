import type { PluginServerContext } from "@getpaseo/plugin/server";
import pkg from "./package.json" with { type: "json" };
import { status } from "./shared/contracts.ts";

export default function contribute(server: PluginServerContext) {
  server.handle(status, async () => ({ version: pkg.version, configured: false }));
  return () => {};
}
