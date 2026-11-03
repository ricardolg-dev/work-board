import { z } from "zod";

import { columnSchema } from "./task.schema";

export const bulkMoveTasksSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Task ids must be unique.",
    }),
  destination: columnSchema,
});

export type BulkMoveTasksInput = z.infer<typeof bulkMoveTasksSchema>;
