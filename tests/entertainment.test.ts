import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import {
  GameEngine,
  boardWinner,
  type GameSession,
} from "../src/modules/entertainment/engine.js";
import { questions } from "../src/modules/entertainment/questions.js";
import { renderGame } from "../src/modules/entertainment/render.js";
import {
  entertainmentModule,
  settleGameRewards,
} from "../src/modules/entertainment/index.js";
import type {
  CommandContext,
  ComponentInteraction,
  Runtime,
} from "../src/core/types.js";
import { Registry } from "../src/core/registry.js";
import { Scheduler } from "../src/core/scheduler.js";
import { pino } from "pino";
import { EconomyService } from "../src/modules/economy/service.js";
import { LevelingService } from "../src/modules/leveling/service.js";

let db: Store;
let clock: number;
let engine: GameEngine;
const base = {
  guild: "guild",
  channel: "channel",
  players: ["alice", "bob"],
  locale: "tr" as const,
};
beforeEach(() => {
  db = new Store(":memory:");
  clock = 1000000;
  engine = new GameEngine(
    db,
    () => clock,
    () => 0,
  );
});
afterEach(() => db?.close());
function create(kind: "xox" | "connect4" | "duello" = "xox") {
  const s = engine.create({ ...base, kind });
  return engine.act(s.guild, s.id, {
    user: "bob",
    version: s.version,
    action: "accept",
  });
}
function move(s: GameSession, value: number, user = s.players[s.turn]!) {
  return engine.act(s.guild, s.id, {
    user,
    version: s.version,
    action: "move",
    value: String(value),
  });
}

describe("persistent game engine", () => {
  it("requires the challenged player to accept and rejects outsiders", () => {
    const s = engine.create({ ...base, kind: "xox" });
    expect(() =>
      engine.act(s.guild, s.id, {
        user: "alice",
        version: 0,
        action: "accept",
      }),
    ).toThrow("error.permission");
    expect(() =>
      engine.act(s.guild, s.id, {
        user: "mallory",
        version: 0,
        action: "accept",
      }),
    ).toThrow("error.permission");
    expect(() =>
      engine.act(s.guild, s.id, {
        user: "bob",
        version: 0,
        action: "move",
        value: "0",
      }),
    ).toThrow();
    expect(
      engine.act(s.guild, s.id, { user: "bob", version: 0, action: "reject" })
        .status,
    ).toBe("rejected");
  });
  it("enforces turns, occupied cells, stale versions, and three-in-a-row", () => {
    let s = create();
    expect(() => move(s, 0, "bob")).toThrow("game.turn");
    const old = s;
    s = move(s, 0);
    expect(() => move(old, 1, "bob")).toThrow("game.stale");
    expect(() => move(s, 0)).toThrow("game.occupied");
    s = move(s, 3);
    s = move(s, 1);
    s = move(s, 4);
    s = move(s, 2);
    expect(s.status).toBe("won");
    expect(s.winner).toBe("alice");
    expect(() => move(s, 5)).toThrow("error.expired");
  });
  it("detects a drawn XOX game", () => {
    let s = create();
    for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) s = move(s, cell);
    expect(s.status).toBe("draw");
    expect(s.winner).toBeUndefined();
  });
  it("drops Connect Four tokens and detects vertical wins", () => {
    let s = create("connect4");
    for (const column of [0, 1, 0, 1, 0, 1, 0]) s = move(s, column);
    expect(s.status).toBe("won");
    expect(s.winner).toBe("alice");
    expect(s.board[35]).toBe(1);
  });
  it("rejects full Connect Four columns without advancing the turn", () => {
    let s = create("connect4");
    for (let i = 0; i < 6; i++) s = move(s, 0);
    expect(() => move(s, 0)).toThrow("game.occupied");
    expect(engine.get(s.guild, s.id)!.version).toBe(s.version);
  });
  it("does not wrap board wins across row boundaries and finds diagonals", () => {
    expect(boardWinner([0, 0, 1, 1, 1, 0, 0, 0, 0], 3, 3, 3)).toBe(0);
    expect(boardWinner([2, 0, 0, 0, 2, 0, 0, 0, 2], 3, 3, 3)).toBe(2);
    const board = Array.from({ length: 42 }, () => 0);
    for (const index of [35, 29, 23, 17]) board[index] = 1;
    expect(boardWinner(board, 7, 6, 4)).toBe(1);
  });
  it("holds RPS selections private until both players select, and prevents duplicate selection", () => {
    let s = createRps();
    s = engine.act(s.guild, s.id, {
      user: "alice",
      version: s.version,
      action: "pick",
      value: "0",
    });
    expect(s.status).toBe("active");
    expect(JSON.stringify(renderGame(s))).not.toContain("Taş:");
    expect(() =>
      engine.act(s.guild, s.id, {
        user: "alice",
        version: s.version,
        action: "pick",
        value: "1",
      }),
    ).toThrow("game.selected");
    s = engine.act(s.guild, s.id, {
      user: "bob",
      version: s.version,
      action: "pick",
      value: "2",
    });
    expect(s.status).toBe("won");
    expect(s.winner).toBe("alice");
  });
  it("plays RPS against the bot without an invitation", () => {
    const s = engine.create({
      ...base,
      players: ["alice", "bot"],
      kind: "tkm",
    });
    const result = engine.act(s.guild, s.id, {
      user: "alice",
      version: 0,
      action: "pick",
      value: "1",
    });
    expect(result.status).toBe("won");
    expect(result.winner).toBe("alice");
  });
  it("expires games durably and never accepts late actions", () => {
    const s = create();
    clock = s.expires;
    expect(() => move(s, 0)).toThrow("error.expired");
    expect(engine.expire(s.guild, s.id)!.status).toBe("expired");
    expect(engine.get(s.guild, s.id)!.status).toBe("expired");
  });
  it("isolates guild sessions and limits a player to one active game", () => {
    const s = create();
    expect(engine.get("other-guild", s.id)).toBeUndefined();
    expect(() =>
      engine.create({ ...base, kind: "quiz", players: ["alice"] }),
    ).toThrow("game.already");
    expect(
      engine.create({
        ...base,
        guild: "other-guild",
        kind: "quiz",
        players: ["alice"],
      }).status,
    ).toBe("active");
  });
  it("enforces guessing limits, validates number input, and detects correct numbers", () => {
    let s = engine.create({ ...base, kind: "sayi", players: ["alice"] });
    expect(() =>
      engine.act(s.guild, s.id, {
        user: "alice",
        version: 0,
        action: "guess",
        value: "0",
      }),
    ).toThrow();
    for (const value of ["2", "3", "4", "5", "6", "7", "8"])
      s = engine.act(s.guild, s.id, {
        user: "alice",
        version: s.version,
        action: "guess",
        value,
      });
    expect(s.status).toBe("lost");
    s = engine.create({ ...base, kind: "sayi", players: ["alice"] });
    expect(
      engine.act(s.guild, s.id, {
        user: "alice",
        version: 0,
        action: "guess",
        value: "1",
      }).winner,
    ).toBe("alice");
  });
  it("accepts Turkish letter guesses and prevents repeated guesses", () => {
    let s = engine.create({ ...base, kind: "adamasmaca", players: ["alice"] });
    s = engine.act(s.guild, s.id, {
      user: "alice",
      version: s.version,
      action: "guess",
      value: "G",
    });
    expect(() =>
      engine.act(s.guild, s.id, {
        user: "alice",
        version: s.version,
        action: "guess",
        value: "g",
      }),
    ).toThrow("game.duplicate");
    s = engine.act(s.guild, s.id, {
      user: "alice",
      version: s.version,
      action: "guess",
      value: "GEZEGEN",
    });
    expect(s.status).toBe("won");
  });
  it("supports every quiz category in both languages and checks answers on the server", () => {
    expect(new Set(questions.map((q) => q.category)).size).toBe(6);
    for (const q of questions) {
      expect(q.text.tr.length).toBeGreaterThan(0);
      expect(q.text.en.length).toBeGreaterThan(0);
      expect(q.options.tr.length).toBe(4);
      expect(q.options.en.length).toBe(4);
      expect(q.answer).toBeLessThan(4);
    }
    const s = engine.create({
      ...base,
      kind: "quiz",
      players: ["alice"],
      category: "science",
    });
    const answer = questions.find((q) => q.id === s.questionId)!.answer;
    expect(
      engine.act(s.guild, s.id, {
        user: "alice",
        version: 0,
        action: "pick",
        value: String(answer),
      }).status,
    ).toBe("won");
  });
  it("persists turn state across a database restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "executive-game-"));
    const file = join(directory, "game.sqlite");
    try {
      let durable = new Store(file);
      let e = new GameEngine(
        durable,
        () => clock,
        () => 0,
      );
      const s = e.create({ ...base, kind: "xox" });
      e.act(s.guild, s.id, { user: "bob", version: 0, action: "accept" });
      durable.close();
      durable = new Store(file);
      e = new GameEngine(
        durable,
        () => clock,
        () => 0,
      );
      const loaded = e.get(s.guild, s.id)!;
      expect(loaded.status).toBe("active");
      expect(loaded.version).toBe(1);
      expect(
        e.act(s.guild, s.id, {
          user: "alice",
          version: 1,
          action: "move",
          value: "0",
        }).board[0],
      ).toBe(1);
      durable.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("credits a game result only once, including after a repeated settlement", () => {
    let s = create();
    for (const cell of [0, 3, 1, 4, 2]) s = move(s, cell);
    const settings = new Settings(db),
      runtime = { db, settings } as Runtime;
    settleGameRewards(runtime, s);
    settleGameRewards(runtime, s);
    expect(new EconomyService(db, settings).balance(s.guild, "alice")).toBe(10);
    expect(new LevelingService(db, settings).profile(s.guild, "alice").xp).toBe(
      5,
    );
    expect(db.get<GameSession>(s.guild, "gameSessions", s.id)!.rewarded).toBe(
      true,
    );
  });
  it("does not award currency or XP from disabled modules", () => {
    let s = create();
    for (const cell of [0, 3, 1, 4, 2]) s = move(s, cell);
    const settings = new Settings(db);
    settings.update(s.guild, { disabledModules: ["economy", "leveling"] });
    settleGameRewards({ db, settings } as Runtime, s);
    expect(new EconomyService(db, settings).balance(s.guild, "alice")).toBe(0);
    expect(new LevelingService(db, settings).profile(s.guild, "alice").xp).toBe(
      0,
    );
  });
  it("acknowledges slash creation and acknowledges a winning button exactly once before updating the board", async () => {
    const settings = new Settings(db),
      registry = new Registry(),
      logger = pino({ level: "silent" }),
      scheduler = new Scheduler(db, settings, logger);
    const edit = vi.fn().mockResolvedValue({}),
      reply = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      db,
      settings,
      registry,
      logger,
      scheduler,
      interactions: new Map(),
      client: {
        channels: {
          fetch: vi
            .fn()
            .mockResolvedValue({ isTextBased: () => true, messages: { edit } }),
        },
      },
    } as unknown as Runtime;
    entertainmentModule.register(runtime);
    const ctx = {
      runtime,
      guild: { id: "guild" },
      user: { id: "alice" },
      channel: {
        id: "channel",
        isSendable: () => true,
        send: vi.fn().mockResolvedValue({ id: "message" }),
      },
      locale: "en",
      args: ["science"],
      reply,
    } as unknown as CommandContext;
    await registry.find("quiz")!.execute(ctx);
    expect(reply).toHaveBeenCalledExactlyOnceWith("Changes saved.");
    const s = db.list<GameSession>("guild", "gameSessions")[0]!.value;
    expect(s.message).toBe("message");
    expect(db.list("guild", "jobs")).toHaveLength(1);
    const answer = questions.find((q) => q.id === s.questionId)!.answer;
    const deferReply = vi.fn().mockResolvedValue(undefined),
      editReply = vi.fn().mockResolvedValue(undefined);
    const i = {
      guildId: "guild",
      channelId: "channel",
      message: { id: "message" },
      customId: `game:${s.id}:${s.version}:pick:${answer}`,
      user: { id: "alice" },
      isButton: () => true,
      isMessageComponent: () => true,
      isModalSubmit: () => false,
      deferReply,
      editReply,
    } as unknown as ComponentInteraction;
    await runtime.interactions.get("game")!.handle(i, runtime);
    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(deferReply.mock.invocationCallOrder[0]!).toBeLessThan(
      edit.mock.invocationCallOrder[0]!,
    );
    expect(new EconomyService(db, settings).balance("guild", "alice")).toBe(10);
  });
});
function createRps() {
  const s = engine.create({ ...base, kind: "tkm" });
  return engine.act(s.guild, s.id, {
    user: "bob",
    version: 0,
    action: "accept",
  });
}
