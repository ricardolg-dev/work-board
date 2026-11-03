import { type CachePort } from "../../../../shared/cache/cache.port";
import { type BoardRepository } from "../../domain/repositories/board.repository";
import { type ActionResult, type BoardState } from "../../domain/board.types";
import { boardCacheKeys } from "../board-cache.keys";
import { BoardUnavailableError } from "../board-unavailable.error";

type Outcome = { result: ActionResult; state: BoardState; revision: number };

export class BulkMoveTasksUseCase {
  constructor(
    private readonly repository: BoardRepository,
    private readonly wipLimit: number,
    private readonly cache: CachePort,
    private readonly ttlSeconds: number,
  ) {}

  async execute(ids: string[], destination: string): Promise<Outcome> {
    try {
      const current = await this.repository.read(this.wipLimit);
      if (
        destination === "in_progress" &&
        current.state.columns.in_progress.length + ids.length > this.wipLimit
      ) {
        return {
          ...current,
          result: {
            status: "error",
            code: "wip_limit_reached",
            message: "In Progress is full.",
          },
        };
      }

      let outcome: Outcome = {
        ...current,
        result: {
          status: "no_change",
          code: "already_in_column",
          message: "Tasks are already in that column.",
        },
      };
      let changed = false;
      for (const id of ids) {
        outcome = await this.repository.run(this.wipLimit, (board) =>
          board.moveTask(id, destination),
        );
        if (outcome.result.status === "error") {
          return outcome;
        }
        changed ||= outcome.result.status === "success";
      }

      if (changed) {
        outcome.result = {
          status: "success",
          code: "tasks_moved",
          message: "Tasks moved.",
        };
        await this.remember(outcome);
      }
      return outcome;
    } catch (error) {
      if (error instanceof BoardUnavailableError) {
        throw error;
      }
      throw new BoardUnavailableError("The board could not be saved.");
    }
  }

  private async remember(outcome: Outcome): Promise<void> {
    try {
      const revision = await this.repository.currentRevision();
      await this.cache.set(
        boardCacheKeys.state,
        { revision, board: outcome.state },
        this.ttlSeconds,
      );
    } catch {
      return;
    }
  }
}
