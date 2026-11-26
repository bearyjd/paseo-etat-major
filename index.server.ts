import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPlugin } from "./server/plugin.ts";
import { createRunner } from "./server/runner.ts";

export default function contribute(server: PluginServerContext) {
  // The runner's log events carry a code and a redacted line only; the default sink drops them.
  return createPlugin(server, createRunner());
}
