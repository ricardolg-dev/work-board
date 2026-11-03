import { z } from "zod";

import { boardSchema } from "./board.schema";

export const actionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    code: z.enum(["task_created", "task_moved", "tasks_moved", "undo_success"]),
    message: z.string(),
  }),
  z.object({
    status: z.literal("no_change"),
    code: z.enum(["already_in_column", "nothing_to_undo"]),
    message: z.string(),
  }),
  z.object({
    status: z.literal("error"),
    code: z.enum([
      "validation_error",
      "duplicate_task_id",
      "task_not_found",
      "invalid_column",
      "wip_limit_reached",
    ]),
    message: z.string(),
  }),
]);

export const boardMutationSchema = z.object({
  result: actionResultSchema,
  board: boardSchema,
});

export type ActionResult = z.infer<typeof actionResultSchema>;
export type BoardMutation = z.infer<typeof boardMutationSchema>;
