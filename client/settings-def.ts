import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Client twin of the server registration (server/settings.ts): same id, scope and version,
// kept in step by a test. Fields stay plain strings here; the server schema is the real gate
// and its fixed messages come back as the save error.
export const clientSettings = defineSettings({
  id: "etat-major",
  scope: "host",
  version: 1,
  schema: z.object({
    executable: z.string().optional(),
    workspace: z.string().optional(),
    project: z.string().optional(),
    prs: z.string().optional(),
    releases: z.string().optional(),
  }),
});
