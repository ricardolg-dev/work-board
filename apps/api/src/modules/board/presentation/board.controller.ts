import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import { bulkMoveTasksSchema, createTaskSchema, moveTaskSchema } from "@repo/contracts";
import { type Response } from "express";

import { BulkMoveTasksUseCase } from "../application/use-cases/bulk-move-tasks.use-case";
import { CreateTaskUseCase } from "../application/use-cases/create-task.use-case";
import { GetBoardUseCase } from "../application/use-cases/get-board.use-case";
import { MoveTaskUseCase } from "../application/use-cases/move-task.use-case";
import { UndoBoardUseCase } from "../application/use-cases/undo-board.use-case";
import { type ActionResult, type BoardState } from "../domain/board.types";
import { httpStatusFor } from "./board-http";

type MutationResponse = {
  result: ActionResult;
  board: BoardState;
};

@Controller()
export class BoardController {
  constructor(
    private readonly getBoard: GetBoardUseCase,
    private readonly createTask: CreateTaskUseCase,
    private readonly moveTask: MoveTaskUseCase,
    private readonly undoBoard: UndoBoardUseCase,
    private readonly bulkMoveTasks: BulkMoveTasksUseCase,
  ) {}

  @Get("board")
  get(): Promise<BoardState> {
    return this.getBoard.execute();
  }

  @Post("tasks")
  async create(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<MutationResponse> {
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      const current = await this.getBoard.execute();
      response.status(httpStatusFor("validation_error"));
      return validationResponse(parsed.error.issues[0]?.message ?? "Enter a visible title.", current);
    }

    const outcome = await this.createTask.execute({ title: parsed.data.title });
    response.status(httpStatusFor(outcome.result.code));
    return { result: outcome.result, board: outcome.state };
  }

  @Post("tasks/:id/move")
  async move(
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MutationResponse> {
    const parsed = moveTaskSchema.safeParse(body);
    if (!parsed.success) {
      const current = await this.getBoard.execute();
      response.status(httpStatusFor("validation_error"));
      return validationResponse(parsed.error.issues[0]?.message ?? "Enter a destination.", current);
    }

    const outcome = await this.moveTask.execute(id, parsed.data.destination);
    response.status(httpStatusFor(outcome.result.code));
    return { result: outcome.result, board: outcome.state };
  }

  @Post("tasks/bulk-move")
  async bulkMove(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MutationResponse> {
    const parsed = bulkMoveTasksSchema.safeParse(body);
    if (!parsed.success) {
      const current = await this.getBoard.execute();
      response.status(httpStatusFor("validation_error"));
      return validationResponse(
        parsed.error.issues[0]?.message ?? "Enter task ids and a destination.",
        current,
      );
    }
    const outcome = await this.bulkMoveTasks.execute(
      parsed.data.ids,
      parsed.data.destination,
    );
    response.status(httpStatusFor(outcome.result.code));
    return { result: outcome.result, board: outcome.state };
  }

  @Post("board/undo")
  async undo(@Res({ passthrough: true }) response: Response): Promise<MutationResponse> {
    const outcome = await this.undoBoard.execute();
    response.status(httpStatusFor(outcome.result.code));
    return { result: outcome.result, board: outcome.state };
  }
}

function validationResponse(message: string, board: BoardState): MutationResponse {
  return {
    result: {
      status: "error",
      code: "validation_error",
      message,
    },
    board,
  };
}
