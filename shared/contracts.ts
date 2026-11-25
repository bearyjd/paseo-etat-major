import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const status = defineRpc({
  name: "etat-major.status.get",
  input: z.object({}),
  output: z.object({
    version: z.string(),
    configured: z.boolean(),
  }),
});
