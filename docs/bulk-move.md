# Move selected tasks

The board needs an API operation for moving a selection of tasks to one column.
This change adds the endpoint; selecting cards in the UI is a later change.

`POST /api/v1/tasks/bulk-move`

```json
{ "ids": ["task-a", "task-b"], "destination": "done" }
```

## Contract

- `ids` contains 1–50 distinct, nonempty task identifiers. The identifiers are opaque strings, as in the existing domain. The destination is `todo`, `in_progress`, or `done`. Invalid input returns 400 with `validation_error`.
- The selection is atomic: either all requested moves are accepted or none are committed. Missing tasks return 404 with `task_not_found`; exceeding the work-in-progress limit returns 409 with `wip_limit_reached`. Rejected selections leave both the board and undo history unchanged.
- Tasks already in the destination are valid no-ops and consume no additional capacity. Exactly filling the work-in-progress limit is allowed. A selection containing only no-ops returns 200 with `already_in_column` and does not add history.
- At least one effective move returns 200 with `tasks_moved`. The response uses the existing `{ result, board }` shape and contains the committed board.
- Undo remains per task: each effective move adds its usual history entry, in request order. Undo reverses the last effective move first. Grouping a selection into a single undo action is outside this change.
- Existing task ordering, identifiers and single-task operations are preserved.
- The database remains authoritative under concurrent requests. Cache failures must not turn a committed operation into a failure, and a subsequent read must not treat an older board as the latest database revision.
- A database failure returns the existing 503 response and must not commit a partial selection.

## Review exercise

This is an interview PR produced with AI. It may contain defects and valid choices.
Review against the contract, explain what you would keep or change, verify your
findings, and state the conditions under which you would release it.
Before running code or consulting AI, describe your initial prediction and
verification plan. No frontend implementation or database migration is requested.
