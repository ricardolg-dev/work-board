import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { type Env } from "../../config/env.schema";
import { CACHE_PORT, type CachePort } from "../../shared/cache/cache.port";
import { BulkMoveTasksUseCase } from "./application/use-cases/bulk-move-tasks.use-case";
import { CreateTaskUseCase } from "./application/use-cases/create-task.use-case";
import { GetBoardUseCase } from "./application/use-cases/get-board.use-case";
import { MoveTaskUseCase } from "./application/use-cases/move-task.use-case";
import { UndoBoardUseCase } from "./application/use-cases/undo-board.use-case";
import { BOARD_REPOSITORY, type BoardRepository } from "./domain/repositories/board.repository";
import { PrismaBoardRepository } from "./infrastructure/persistence/repositories/prisma-board.repository";
import { BoardController } from "./presentation/board.controller";

@Module({
  controllers: [BoardController],
  providers: [
    {
      provide: BulkMoveTasksUseCase,
      useFactory: (
        repository: BoardRepository,
        cache: CachePort,
        config: ConfigService<Env, true>,
      ) =>
        new BulkMoveTasksUseCase(
          repository,
          config.get("BOARD_WIP_LIMIT", { infer: true }),
          cache,
          config.get("CACHE_TTL_SECONDS", { infer: true }),
        ),
      inject: [BOARD_REPOSITORY, CACHE_PORT, ConfigService],
    },
    PrismaBoardRepository,
    {
      provide: BOARD_REPOSITORY,
      useExisting: PrismaBoardRepository,
    },
    {
      provide: GetBoardUseCase,
      useFactory: (repository: BoardRepository, cache: CachePort, config: ConfigService<Env, true>) =>
        new GetBoardUseCase(
          repository,
          config.get("BOARD_WIP_LIMIT", { infer: true }),
          cache,
          config.get("CACHE_TTL_SECONDS", { infer: true }),
        ),
      inject: [BOARD_REPOSITORY, CACHE_PORT, ConfigService],
    },
    {
      provide: CreateTaskUseCase,
      useFactory: (repository: BoardRepository, cache: CachePort, config: ConfigService<Env, true>) =>
        new CreateTaskUseCase(
          repository,
          config.get("BOARD_WIP_LIMIT", { infer: true }),
          cache,
          config.get("CACHE_TTL_SECONDS", { infer: true }),
        ),
      inject: [BOARD_REPOSITORY, CACHE_PORT, ConfigService],
    },
    {
      provide: MoveTaskUseCase,
      useFactory: (repository: BoardRepository, cache: CachePort, config: ConfigService<Env, true>) =>
        new MoveTaskUseCase(
          repository,
          config.get("BOARD_WIP_LIMIT", { infer: true }),
          cache,
          config.get("CACHE_TTL_SECONDS", { infer: true }),
        ),
      inject: [BOARD_REPOSITORY, CACHE_PORT, ConfigService],
    },
    {
      provide: UndoBoardUseCase,
      useFactory: (repository: BoardRepository, cache: CachePort, config: ConfigService<Env, true>) =>
        new UndoBoardUseCase(
          repository,
          config.get("BOARD_WIP_LIMIT", { infer: true }),
          cache,
          config.get("CACHE_TTL_SECONDS", { infer: true }),
        ),
      inject: [BOARD_REPOSITORY, CACHE_PORT, ConfigService],
    },
  ],
})
export class BoardModule {}
