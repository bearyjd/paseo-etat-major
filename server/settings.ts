import { z } from "zod";
import { isCleanAbsolute } from "./validate-exe.ts";
import { isValidProject } from "./validate-input.ts";

// Messages are fixed strings: a rejected value is never echoed back or logged.
const absolutePath = z.string().max(4096).refine(isCleanAbsolute, { message: "must be a clean absolute path" });
// Empty means "not passed", so it must not invalidate the whole document.
const optionalPath = z.union([z.literal(""), absolutePath]).optional();
const projectId = z.string().refine(isValidProject, { message: "must be a valid project id" });

export const SettingsSchema = z.object({
  executable: absolutePath.optional(),
  workspace: absolutePath.optional(),
  project: projectId.optional(),
  prs: optionalPath,
  releases: optionalPath,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_ID = "etat-major";
export const SETTINGS_VERSION = 1;
