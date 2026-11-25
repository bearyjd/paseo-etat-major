import type { PluginServerContext } from "@getpaseo/plugin/server";
import { VERSION } from "./shared/version.ts";
import { status } from "./shared/contracts.ts";

export default function contribute(server: PluginServerContext) {
  server.handle(status, async () => ({ version: VERSION, configured: false }));
  return () => {};
}
