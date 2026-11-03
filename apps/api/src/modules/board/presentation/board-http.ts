import { type ActionResult } from "../domain/board.types";

const HTTP_STATUS: Record<ActionResult["code"], number> = {
  task_created: 201,
  task_moved: 200,
  tasks_moved: 200,
  undo_success: 200,
  already_in_column: 200,
  nothing_to_undo: 200,
  validation_error: 400,
  invalid_column: 400,
  task_not_found: 404,
  duplicate_task_id: 409,
  wip_limit_reached: 409,
};

export function httpStatusFor(code: ActionResult["code"]): number {
  return HTTP_STATUS[code];
}
