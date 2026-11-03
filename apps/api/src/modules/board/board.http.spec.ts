import { type INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { validateEnv } from "../../config/env.schema";
import { CACHE_PORT, type CachePort } from "../../shared/cache/cache.port";
import { GlobalExceptionFilter } from "../../shared/errors/global-exception.filter";
import { createValidationPipe } from "../../shared/validation/create-validation-pipe";
import { BulkMoveTasksUseCase } from "./application/use-cases/bulk-move-tasks.use-case";
import { CreateTaskUseCase } from "./application/use-cases/create-task.use-case";
import { GetBoardUseCase } from "./application/use-cases/get-board.use-case";
import { MoveTaskUseCase } from "./application/use-cases/move-task.use-case";
import { UndoBoardUseCase } from "./application/use-cases/undo-board.use-case";
import { type BoardRepository } from "./domain/repositories/board.repository";
import { type ActionResult, type BoardState } from "./domain/board.types";
import { BOARD_REPOSITORY } from "./domain/repositories/board.repository";
import { BoardController } from "./presentation/board.controller";
import { InMemoryBoardRepository } from "./testing/in-memory-board.repository";
import { InMemoryCache } from "./testing/in-memory-cache";

async function createBoardApp(
  repository: BoardRepository = new InMemoryBoardRepository(),
  cache: CachePort = new InMemoryCache(),
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: (config: Record<string, unknown>) =>
          validateEnv({ ...config, BOARD_WIP_LIMIT: "2" }),
      }),
    ],
    controllers: [BoardController],
    providers: [
      {
        provide: BulkMoveTasksUseCase,
        useFactory: (repo: BoardRepository, boardCache: CachePort) =>
          new BulkMoveTasksUseCase(repo, 2, boardCache, 60),
        inject: [BOARD_REPOSITORY, CACHE_PORT],
      },
      { provide: BOARD_REPOSITORY, useValue: repository },
      { provide: CACHE_PORT, useValue: cache },
      {
        provide: GetBoardUseCase,
        useFactory: (repo: BoardRepository, boardCache: CachePort) => new GetBoardUseCase(repo, 2, boardCache, 60),
        inject: [BOARD_REPOSITORY, CACHE_PORT],
      },
      {
        provide: CreateTaskUseCase,
        useFactory: (repo: BoardRepository, boardCache: CachePort) => new CreateTaskUseCase(repo, 2, boardCache, 60),
        inject: [BOARD_REPOSITORY, CACHE_PORT],
      },
      {
        provide: MoveTaskUseCase,
        useFactory: (repo: BoardRepository, boardCache: CachePort) => new MoveTaskUseCase(repo, 2, boardCache, 60),
        inject: [BOARD_REPOSITORY, CACHE_PORT],
      },
      {
        provide: UndoBoardUseCase,
        useFactory: (repo: BoardRepository, boardCache: CachePort) => new UndoBoardUseCase(repo, 2, boardCache, 60),
        inject: [BOARD_REPOSITORY, CACHE_PORT],
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

class ThrowingBoardRepository implements BoardRepository {
  async currentRevision(): Promise<number> {
    return 0;
  }

  async read(): Promise<{ state: BoardState; revision: number }> {
    return {
      revision: 0,
      state: {
        columns: { todo: [], in_progress: [], done: [] },
        wipLimit: 2,
        canUndo: false,
      },
    };
  }

  async run(): Promise<{ result: ActionResult; state: BoardState; revision: number }> {
    throw new Error("database down");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BoardTaskBody = { id: string; title: string; column: string };
type BoardBody = {
  columns: { todo: BoardTaskBody[]; in_progress: BoardTaskBody[]; done: BoardTaskBody[] };
  wipLimit: number;
  canUndo: boolean;
};

function findTask(board: BoardBody, title: string): BoardTaskBody {
  const task = [...board.columns.todo, ...board.columns.in_progress, ...board.columns.done].find(
    (item) => item.title === title,
  );
  if (!task) {
    throw new Error(`Missing task ${title}`);
  }
  return task;
}

describe("Board HTTP", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createBoardApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns an empty board", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/board").expect(200);

    expect(response.body).toEqual({
      columns: { todo: [], in_progress: [], done: [] },
      wipLimit: 2,
      canUndo: false,
    });
  });

  it("moves selected tasks through the bulk endpoint", async () => {
    const server = app.getHttpServer();
    const createdA = await request(server)
      .post("/api/v1/tasks")
      .send({ title: "A" })
      .expect(201);
    const createdB = await request(server)
      .post("/api/v1/tasks")
      .send({ title: "B" })
      .expect(201);
    const ids = [
      findTask(createdA.body.board, "A").id,
      findTask(createdB.body.board, "B").id,
    ];
    const moved = await request(server)
      .post("/api/v1/tasks/bulk-move")
      .send({ ids, destination: "done" })
      .expect(200);
    expect(moved.body.result.code).toBe("tasks_moved");
    expect(moved.body.board.columns.done.map((task: BoardTaskBody) => task.id)).toEqual(
      ids,
    );
    const saved = await request(server).get("/api/v1/board").expect(200);
    expect(saved.body).toEqual(moved.body.board);
  });

  it("creates a task in To Do", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/tasks")
      .send({ title: "Prepare the report" })
      .expect(201);

    expect(response.body.result.code).toBe("task_created");
    const created = findTask(response.body.board, "Prepare the report");
    expect(created.id).toMatch(UUID);
    expect(created.column).toBe("todo");
    expect(response.body.board.columns.todo).toEqual([created]);
    expect(response.body.board.columns.in_progress).toEqual([]);
    expect(response.body.board.columns.done).toEqual([]);
    expect(response.body.board.canUndo).toBe(true);
  });

  it("creates a second task when the title is repeated and ignores a supplied id", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/v1/tasks")
      .send({ title: "Prepare the report" })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/api/v1/tasks")
      .send({ id: "client-id", title: "Prepare the report" })
      .expect(201);

    const firstTask = findTask(first.body.board, "Prepare the report");
    const tasks = second.body.board.columns.todo as BoardTaskBody[];
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.title)).toEqual(["Prepare the report", "Prepare the report"]);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(2);
    expect(tasks.some((task) => task.id === "client-id")).toBe(false);
    expect(tasks.some((task) => task.id === firstTask.id)).toBe(true);
  });

  it("rejects a spaces-only title and leaves the board unchanged", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/tasks")
      .send({ title: "Prepare the report" })
      .expect(201);
    const before = await request(app.getHttpServer()).get("/api/v1/board").expect(200);

    const response = await request(app.getHttpServer())
      .post("/api/v1/tasks")
      .send({ title: "   " })
      .expect(400);

    expect(response.body.result.code).toBe("validation_error");
    expect(response.body.board).toEqual(before.body);
  });

  it("maps move outcomes to the specified statuses", async () => {
    const createdA = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "A" }).expect(201);
    const createdB = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "B" }).expect(201);
    const createdC = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "C" }).expect(201);
    const idA = findTask(createdA.body.board, "A").id;
    const idB = findTask(createdB.body.board, "B").id;
    const idC = findTask(createdC.body.board, "C").id;

    const moved = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${idA}/move`)
      .send({ destination: "in_progress" })
      .expect(200);
    expect(moved.body.result.code).toBe("task_moved");

    const sameColumn = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${idA}/move`)
      .send({ destination: "in_progress" })
      .expect(200);
    expect(sameColumn.body.result.code).toBe("already_in_column");

    const missing = await request(app.getHttpServer())
      .post("/api/v1/tasks/Z/move")
      .send({ destination: "done" })
      .expect(404);
    expect(missing.body.result.code).toBe("task_not_found");

    const invalid = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${idA}/move`)
      .send({ destination: "not-a-column" })
      .expect(400);
    expect(invalid.body.result.code).toBe("invalid_column");

    const missingDestination = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${idA}/move`)
      .send({})
      .expect(400);
    expect(missingDestination.body.result.code).toBe("validation_error");
    expect(missingDestination.body.board).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${idB}/move`)
      .send({ destination: "in_progress" })
      .expect(200);
    const full = await request(app.getHttpServer()).get("/api/v1/board");

    const refused = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${idC}/move`)
      .send({ destination: "in_progress" })
      .expect(409);

    expect(refused.body.result.code).toBe("wip_limit_reached");
    expect(refused.body.board).toEqual(full.body);
    expect(refused.body.board.canUndo).toBe(full.body.canUndo);
  });

  it("undoes a recorded step and reports an empty history as no change", async () => {
    const empty = await request(app.getHttpServer()).post("/api/v1/board/undo").expect(200);
    expect(empty.body.result.code).toBe("nothing_to_undo");
    expect(empty.body.board.canUndo).toBe(false);
    expect(empty.body.board.columns.todo).toEqual([]);

    const created = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "A" }).expect(201);
    const idA = findTask(created.body.board, "A").id;
    await request(app.getHttpServer()).post(`/api/v1/tasks/${idA}/move`).send({ destination: "done" });

    const undone = await request(app.getHttpServer()).post("/api/v1/board/undo").expect(200);
    expect(undone.body.result.code).toBe("undo_success");
    expect(undone.body.board.columns.todo.map((task: BoardTaskBody) => task.title)).toEqual(["A"]);

    const removed = await request(app.getHttpServer()).post("/api/v1/board/undo").expect(200);
    expect(removed.body.result.code).toBe("undo_success");
    expect(removed.body.board.columns.todo).toEqual([]);
    expect(removed.body.board.canUndo).toBe(false);
  });

  it("runs the official sequence on one board", async () => {
    const createdA = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "A" }).expect(201);
    const createdB = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "B" }).expect(201);
    const createdC = await request(app.getHttpServer()).post("/api/v1/tasks").send({ title: "C" }).expect(201);
    const idA = findTask(createdA.body.board, "A").id;
    const idB = findTask(createdB.body.board, "B").id;
    const idC = findTask(createdC.body.board, "C").id;

    const steps: Array<{ path: string; body?: { destination: string }; status: number; code: string }> = [
      { path: `/api/v1/tasks/${idA}/move`, body: { destination: "in_progress" }, status: 200, code: "task_moved" },
      { path: `/api/v1/tasks/${idB}/move`, body: { destination: "in_progress" }, status: 200, code: "task_moved" },
      { path: `/api/v1/tasks/${idC}/move`, body: { destination: "in_progress" }, status: 409, code: "wip_limit_reached" },
      { path: "/api/v1/board/undo", status: 200, code: "undo_success" },
      { path: `/api/v1/tasks/${idC}/move`, body: { destination: "done" }, status: 200, code: "task_moved" },
      { path: `/api/v1/tasks/${idC}/move`, body: { destination: "done" }, status: 200, code: "already_in_column" },
      { path: "/api/v1/board/undo", status: 200, code: "undo_success" },
    ];

    for (const step of steps) {
      const call = request(app.getHttpServer()).post(step.path);
      const response = step.body ? await call.send(step.body).expect(step.status) : await call.expect(step.status);
      expect(response.body.result.code).toBe(step.code);
    }

    const finalBoard = await request(app.getHttpServer()).get("/api/v1/board").expect(200);
    expect(finalBoard.body.columns.todo.map((task: BoardTaskBody) => task.title).sort()).toEqual(["B", "C"]);
    expect(finalBoard.body.columns.in_progress.map((task: BoardTaskBody) => task.title)).toEqual(["A"]);
    expect(finalBoard.body.columns.done).toEqual([]);
    expect(finalBoard.body.wipLimit).toBe(2);
    expect(finalBoard.body.canUndo).toBe(true);
  });

  it("keeps creation order through the limit and undo sequence", async () => {
    const repository = new InMemoryBoardRepository();
    const ordered = await createBoardApp(repository);
    const server = ordered.getHttpServer();
    const createdC = await request(server).post("/api/v1/tasks").send({ title: "C" }).expect(201);
    const createdA = await request(server).post("/api/v1/tasks").send({ title: "A" }).expect(201);
    const createdB = await request(server).post("/api/v1/tasks").send({ title: "B" }).expect(201);
    const idC = findTask(createdC.body.board, "C").id;
    const idA = findTask(createdA.body.board, "A").id;
    const idB = findTask(createdB.body.board, "B").id;

    const viewed = await request(server).get("/api/v1/board").expect(200);
    expect(viewed.body.columns.todo.map((task: BoardTaskBody) => task.title)).toEqual(["C", "A", "B"]);

    const moveC = await request(server).post(`/api/v1/tasks/${idC}/move`).send({ destination: "in_progress" }).expect(200);
    expect(moveC.body.result.code).toBe("task_moved");
    const moveA = await request(server).post(`/api/v1/tasks/${idA}/move`).send({ destination: "in_progress" }).expect(200);
    expect(moveA.body.result.code).toBe("task_moved");
    expect(moveA.body.board.columns.in_progress.map((task: BoardTaskBody) => task.title)).toEqual(["C", "A"]);
    expect(moveA.body.board.columns.todo.map((task: BoardTaskBody) => task.title)).toEqual(["B"]);

    const refused = await request(server).post(`/api/v1/tasks/${idB}/move`).send({ destination: "in_progress" }).expect(409);
    expect(refused.body.result.code).toBe("wip_limit_reached");
    expect(refused.body.board).toEqual(moveA.body.board);

    const undone = await request(server).post("/api/v1/board/undo").expect(200);
    expect(undone.body.result.code).toBe("undo_success");
    expect(undone.body.board.columns.in_progress.map((task: BoardTaskBody) => task.title)).toEqual(["C"]);
    expect(undone.body.board.columns.todo.map((task: BoardTaskBody) => task.title)).toEqual(["A", "B"]);

    const movedDone = await request(server).post(`/api/v1/tasks/${idB}/move`).send({ destination: "done" }).expect(200);
    expect(movedDone.body.result.code).toBe("task_moved");
    const restarted = await createBoardApp(repository);
    const afterRestart = await request(restarted.getHttpServer()).get("/api/v1/board").expect(200);
    expect(afterRestart.body.columns.done.map((task: BoardTaskBody) => task.title)).toEqual(["B"]);
    await restarted.close();

    const same = await request(server).post(`/api/v1/tasks/${idB}/move`).send({ destination: "done" }).expect(200);
    expect(same.body.result.code).toBe("already_in_column");
    const restored = await request(server).post("/api/v1/board/undo").expect(200);
    expect(restored.body.result.code).toBe("undo_success");
    expect(restored.body.board.columns.todo.map((task: BoardTaskBody) => task.title)).toEqual(["A", "B"]);
    expect(restored.body.board.columns.done).toEqual([]);
    await ordered.close();
  });

  it("returns the saved task from a second app on the same repository", async () => {
    const repository = new InMemoryBoardRepository();
    const first = await createBoardApp(repository);
    await request(first.getHttpServer())
      .post("/api/v1/tasks")
      .send({ title: "Prepare the report" })
      .expect(201);
    await first.close();

    const second = await createBoardApp(repository);
    const response = await request(second.getHttpServer()).get("/api/v1/board").expect(200);
    await second.close();

    expect(response.body.columns.todo).toHaveLength(1);
    expect(response.body.columns.todo[0].title).toBe("Prepare the report");
    expect(response.body.columns.todo[0].id).toMatch(UUID);
    expect(response.body.canUndo).toBe(true);
  });

  it("ignores a cached board whose revision is older than the saved board", async () => {
    const repository = new InMemoryBoardRepository();
    await repository.run(2, (board) => board.createTask("saved-id", "Saved"));
    const cache = new InMemoryCache();
    await cache.set("board:state", {
      revision: 0,
      board: {
        columns: {
          todo: [{ id: "stale-id", title: "Stale", column: "todo" }],
          in_progress: [],
          done: [],
        },
        wipLimit: 2,
        canUndo: false,
      },
    });

    const staleApp = await createBoardApp(repository, cache);
    const response = await request(staleApp.getHttpServer()).get("/api/v1/board").expect(200);
    await staleApp.close();

    expect(response.body.columns.todo.map((task: BoardTaskBody) => task.title)).toEqual(["Saved"]);
  });

  it("returns 503 when the board cannot be saved", async () => {
    const failing = await createBoardApp(new ThrowingBoardRepository());

    const response = await request(failing.getHttpServer())
      .post("/api/v1/tasks")
      .send({ title: "Prepare the report" })
      .expect(503);
    await failing.close();

    expect(response.body).toEqual({
      statusCode: 503,
      error: "SERVICE_UNAVAILABLE",
      code: "BOARD_UNAVAILABLE",
      message: "The board could not be saved.",
    });
    expect(response.body.result).toBeUndefined();
  });
});
