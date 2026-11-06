import { randomInt, randomUUID } from "node:crypto";
import type { Store } from "../../database/store.js";
import type { Locale } from "../../core/localization.js";
import { assert } from "../../shared.js";
import {
  emojiQuestions,
  questions,
  words,
  type QuizCategory,
} from "./questions.js";

export type GameKind =
  | "tkm"
  | "xox"
  | "connect4"
  | "quiz"
  | "kelime"
  | "adamasmaca"
  | "duello"
  | "sayi"
  | "tahmin"
  | "emoji";
export type GameStatus =
  "pending" | "active" | "won" | "lost" | "draw" | "rejected" | "expired";
export interface GameSession {
  id: string;
  guild: string;
  channel: string;
  message?: string;
  kind: GameKind;
  locale: Locale;
  players: string[];
  status: GameStatus;
  turn: number;
  version: number;
  created: number;
  expires: number;
  winner?: string;
  board: number[];
  moves: number;
  choices: Record<string, number>;
  guesses: string[];
  health: number[];
  answer?: string;
  questionId?: string;
  questionIndex?: number;
  secret?: number;
  clue?: "higher" | "lower" | "wrong";
  rewarded?: boolean;
}
export interface CreateGame {
  guild: string;
  channel: string;
  kind: GameKind;
  players: string[];
  locale: Locale;
  category?: QuizCategory;
  duration?: number;
}
export interface GameAction {
  user: string;
  version: number;
  action: string;
  value?: string;
}

export function boardWinner(
  board: readonly number[],
  width: number,
  height: number,
  length: number,
): number {
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const token = board[y * width + x];
      if (!token) continue;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        let count = 1;
        while (count < length) {
          const nx = x + dx! * count,
            ny = y + dy! * count;
          if (
            nx < 0 ||
            nx >= width ||
            ny < 0 ||
            ny >= height ||
            board[ny * width + nx] !== token
          )
            break;
          count++;
        }
        if (count === length) return token;
      }
    }
  return 0;
}
export function normalizeAnswer(value: string, locale: Locale): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase(locale)
    .replace(/\s+/g, " ");
}

export class GameEngine {
  constructor(
    readonly db: Store,
    readonly now: () => number = Date.now,
    readonly random: (max: number) => number = (max) => randomInt(max),
  ) {}
  get(guild: string, id: string): GameSession | undefined {
    return this.db.get(guild, "gameSessions", id);
  }
  create(input: CreateGame): GameSession {
    return this.db.transaction(() => {
      assert(
        input.players.length >= 1 &&
          input.players.length <= 2 &&
          new Set(input.players).size === input.players.length,
      );
      assert(
        input.kind === "tkm"
          ? input.players.length === 2
          : ["xox", "connect4", "duello"].includes(input.kind)
            ? input.players.length === 2 && !input.players.includes("bot")
            : input.players.length === 1,
      );
      const active = this.db
        .list<GameSession>(input.guild, "gameSessions")
        .filter(
          ({ value: s }) =>
            s.expires > this.now() && ["active", "pending"].includes(s.status),
        );
      assert(
        !active.some(({ value: s }) =>
          s.players.some((p) => p !== "bot" && input.players.includes(p)),
        ),
        "game.already",
      );
      const session: GameSession = {
        id: randomUUID().slice(0, 16),
        guild: input.guild,
        channel: input.channel,
        kind: input.kind,
        locale: input.locale,
        players: input.players,
        status:
          input.players.length === 2 && input.players[1] !== "bot"
            ? "pending"
            : "active",
        turn: 0,
        version: 0,
        created: this.now(),
        expires: this.now() + (input.duration ?? 300000),
        board: Array.from(
          {
            length:
              input.kind === "connect4" ? 42 : input.kind === "xox" ? 9 : 0,
          },
          () => 0,
        ),
        moves: 0,
        choices: {},
        guesses: [],
        health: [12, 12],
      };
      if (input.kind === "quiz") {
        const list = questions.filter(
          (q) => !input.category || q.category === input.category,
        );
        assert(list.length);
        const question = list[this.random(list.length)]!;
        session.questionId = question.id;
      }
      if (input.kind === "emoji")
        session.questionIndex = this.random(emojiQuestions.length);
      if (["kelime", "adamasmaca"].includes(input.kind))
        session.answer =
          words[input.locale][this.random(words[input.locale].length)]!;
      if (input.kind === "sayi" || input.kind === "tahmin")
        session.secret = this.random(100) + 1;
      this.db.set(input.guild, "gameSessions", session.id, session);
      return session;
    });
  }
  bind(guild: string, id: string, message: string): void {
    this.db.transaction(() => {
      const session = this.get(guild, id);
      assert(session);
      session.message = message;
      this.db.set(guild, "gameSessions", id, session);
    });
  }
  expire(guild: string, id: string): GameSession | undefined {
    return this.db.transaction(() => {
      const session = this.get(guild, id);
      if (
        !session ||
        !["active", "pending"].includes(session.status) ||
        this.now() < session.expires
      )
        return session;
      session.status = "expired";
      session.version++;
      this.db.set(guild, "gameSessions", id, session);
      return session;
    });
  }
  act(guild: string, id: string, input: GameAction): GameSession {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(s, "error.expired");
      assert(s.players.includes(input.user), "error.permission");
      assert(
        s.expires > this.now() && ["pending", "active"].includes(s.status),
        "error.expired",
      );
      assert(s.version === input.version, "game.stale");
      if (s.status === "pending") {
        assert(input.user === s.players[1], "error.permission");
        assert(input.action === "accept" || input.action === "reject");
        s.status = input.action === "accept" ? "active" : "rejected";
      } else if (input.action === "quit") {
        s.status = "rejected";
      } else if (s.kind === "tkm") this.rps(s, input);
      else if (s.kind === "xox" || s.kind === "connect4") this.board(s, input);
      else if (s.kind === "duello") this.duel(s, input);
      else this.guess(s, input);
      s.version++;
      this.db.set(guild, "gameSessions", s.id, s);
      return s;
    });
  }
  private rps(s: GameSession, input: GameAction): void {
    assert(input.action === "pick");
    const value = Number(input.value);
    assert(Number.isInteger(value) && value >= 0 && value < 3);
    assert(s.choices[input.user] === undefined, "game.selected");
    s.choices[input.user] = value;
    if (s.players[1] === "bot") s.choices.bot = this.random(3);
    const a = s.choices[s.players[0]!],
      b = s.choices[s.players[1]!];
    if (a !== undefined && b !== undefined) {
      if (a === b) s.status = "draw";
      else {
        s.status = "won";
        s.winner = ((a - b + 3) % 3 === 1 ? s.players[0] : s.players[1])!;
      }
    }
  }
  private board(s: GameSession, input: GameAction): void {
    assert(input.action === "move");
    assert(s.players[s.turn] === input.user, "game.turn");
    const value = Number(input.value),
      width = s.kind === "connect4" ? 7 : 3,
      height = s.kind === "connect4" ? 6 : 3;
    assert(
      Number.isInteger(value) &&
        value >= 0 &&
        value < (s.kind === "connect4" ? 7 : 9),
    );
    let cell = value;
    if (s.kind === "connect4") {
      cell = -1;
      for (let y = height - 1; y >= 0; y--)
        if (s.board[y * width + value] === 0) {
          cell = y * width + value;
          break;
        }
    }
    assert(cell >= 0 && s.board[cell] === 0, "game.occupied");
    s.board[cell] = s.turn + 1;
    s.moves++;
    const winner = boardWinner(
      s.board,
      width,
      height,
      s.kind === "connect4" ? 4 : 3,
    );
    if (winner) {
      s.status = "won";
      s.winner = s.players[winner - 1];
    } else if (s.moves === width * height) s.status = "draw";
    else s.turn = 1 - s.turn;
  }
  private duel(s: GameSession, input: GameAction): void {
    assert(input.action === "attack");
    assert(s.players[s.turn] === input.user, "game.turn");
    const opponent = 1 - s.turn;
    s.health[opponent] = Math.max(0, s.health[opponent]! - this.random(6) - 1);
    s.moves++;
    if (s.health[opponent] === 0) {
      s.status = "won";
      s.winner = input.user;
    } else s.turn = opponent;
  }
  private guess(s: GameSession, input: GameAction): void {
    assert(input.user === s.players[0], "error.permission");
    if (s.kind === "quiz" || s.kind === "emoji") {
      assert(input.action === "pick");
      const value = Number(input.value);
      assert(Number.isInteger(value) && value >= 0 && value <= 3);
      const answer =
        s.kind === "quiz"
          ? questions.find((q) => q.id === s.questionId)!.answer
          : emojiQuestions[s.questionIndex!]!.answer;
      s.status = value === answer ? "won" : "lost";
      if (s.status === "won") s.winner = input.user;
      return;
    }
    assert(input.action === "guess");
    const value = normalizeAnswer(input.value ?? "", s.locale);
    assert(value.length >= 1 && value.length <= 100);
    assert(!s.guesses.includes(value), "game.duplicate");
    s.guesses.push(value);
    s.moves++;
    if (s.kind === "sayi" || s.kind === "tahmin") {
      assert(
        /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100,
      );
      const n = Number(value);
      if (n === s.secret) {
        s.status = "won";
        s.winner = input.user;
      } else {
        s.clue = n < s.secret! ? "higher" : "lower";
        if (s.moves >= 7) s.status = "lost";
      }
    } else {
      const answer = normalizeAnswer(s.answer!, s.locale);
      if (
        value === answer ||
        (s.kind === "adamasmaca" &&
          [...answer].every((letter) => s.guesses.includes(letter)))
      ) {
        s.status = "won";
        s.winner = input.user;
      } else {
        s.clue = "wrong";
        const wrong = s.guesses.filter(
          (g) => g.length !== 1 || !answer.includes(g),
        ).length;
        if (s.kind === "adamasmaca" ? wrong >= 6 : s.moves >= 5)
          s.status = "lost";
      }
    }
  }
}
