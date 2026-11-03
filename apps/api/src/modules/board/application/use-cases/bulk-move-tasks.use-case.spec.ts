import { bulkMoveTasksSchema } from "@repo/contracts";

import { InMemoryBoardRepository } from "../../testing/in-memory-board.repository";
import { InMemoryCache } from "../../testing/in-memory-cache";
import { BulkMoveTasksUseCase } from "./bulk-move-tasks.use-case";

async function setup() {
  const repository = new InMemoryBoardRepository();
  const cache = new InMemoryCache();
  await repository.run(2, (board) => board.createTask("a", "A"));
  await repository.run(2, (board) => board.createTask("b", "B"));
  return { repository, cache, move: new BulkMoveTasksUseCase(repository, 2, cache, 60) };
}

describe("bulk move", () => {
  it("moves a selection that exactly fills the work-in-progress limit", async () => {
    const { move } = await setup();
    const outcome = await move.execute(["a", "b"], "in_progress");
    expect(outcome.result.code).toBe("tasks_moved");
    expect(outcome.state.columns.in_progress.map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("preserves task ordering and undoes one effective move at a time", async () => {
    const { move, repository } = await setup();
    const outcome = await move.execute(["b", "a"], "done");
    expect(outcome.state.columns.done.map((task) => task.id)).toEqual(["a", "b"]);
    const undone = await repository.run(2, (board) => board.undo());
    expect(undone.state.columns.todo.map((task) => task.id)).toEqual(["a"]);
    expect(undone.state.columns.done.map((task) => task.id)).toEqual(["b"]);
  });

  it("returns the committed result when cache storage fails", async () => {
    const { move, repository, cache } = await setup();
    cache.failSet = true;
    const outcome = await move.execute(["a", "b"], "done");
    expect(outcome.result.code).toBe("tasks_moved");
    expect((await repository.read(2)).state).toEqual(outcome.state);
  });

  it("does not add history for a selection already in Done", async () => {
    const { move, repository } = await setup();
    await move.execute(["a"], "done");
    const revision = await repository.currentRevision();
    const outcome = await move.execute(["a"], "done");
    expect(outcome.result.status).toBe("no_change");
    expect(await repository.currentRevision()).toBe(revision);
    const undone = await repository.run(2, (board) => board.undo());
    expect(undone.state.columns.done).toEqual([]);
  });

  it("accepts opaque identifiers and rejects duplicates, oversized selections and invalid columns", () => {
    expect(
      bulkMoveTasksSchema.safeParse({ ids: ["a"], destination: "done" }).success,
    ).toBe(true);
    expect(
      bulkMoveTasksSchema.safeParse({ ids: ["a", "a"], destination: "done" }).success,
    ).toBe(false);
    expect(
      bulkMoveTasksSchema.safeParse({ ids: [""], destination: "done" }).success,
    ).toBe(false);
    expect(
      bulkMoveTasksSchema.safeParse({ ids: ["a"], destination: "missing" }).success,
    ).toBe(false);
    expect(
      bulkMoveTasksSchema.safeParse({
        ids: Array.from({ length: 51 }, (_, i) => String(i)),
        destination: "done",
      }).success,
    ).toBe(false);
  });
});
