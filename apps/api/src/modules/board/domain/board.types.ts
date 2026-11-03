export const COLUMNS = ["todo", "in_progress", "done"] as const;

export type Column = (typeof COLUMNS)[number];

export type Task = {
  id: string;
  title: string;
  column: Column;
  sequence: number;
};

export type BoardTaskView = {
  id: string;
  title: string;
  column: Column;
};

export type HistoryEntry =
  | { type: "TASK_CREATED"; taskId: string }
  | { type: "TASK_MOVED"; taskId: string; from: Column; to: Column };

type SuccessCode = "task_created" | "task_moved" | "tasks_moved" | "undo_success";
type NoChangeCode = "already_in_column" | "nothing_to_undo";
type ErrorCode =
  | "validation_error"
  | "duplicate_task_id"
  | "task_not_found"
  | "invalid_column"
  | "wip_limit_reached";

export type ActionResult =
  | { status: "success"; code: SuccessCode; message: string }
  | { status: "no_change"; code: NoChangeCode; message: string }
  | { status: "error"; code: ErrorCode; message: string };

export type BoardState = {
  columns: Record<Column, BoardTaskView[]>;
  wipLimit: number;
  canUndo: boolean;
};

export type BoardSnapshot = {
  tasks: Task[];
  history: HistoryEntry[];
  nextSequence: number;
};
