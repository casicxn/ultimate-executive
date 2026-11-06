import { randomInt, randomUUID } from "node:crypto";
import type { Store } from "../../database/store.js";
import { assert } from "../../shared.js";
export interface Eligibility {
  roleId?: string;
  minAccountDays: number;
  minLevel: number;
}
export interface Giveaway {
  id: string;
  guild: string;
  channel: string;
  message?: string;
  organizer: string;
  prize: string;
  ends: number;
  winnerCount: number;
  eligibility: Eligibility;
  entrants: string[];
  status: "active" | "ended";
  rounds: { at: number; winners: string[] }[];
}
export interface Poll {
  id: string;
  guild: string;
  channel: string;
  message?: string;
  organizer: string;
  question: string;
  options: string[];
  ends: number;
  changeVotes: boolean;
  votes: Record<string, number>;
  status: "active" | "ended";
}
export interface CommunityEvent {
  id: string;
  guild: string;
  channel: string;
  message?: string;
  organizer: string;
  title: string;
  description: string;
  starts: number;
  attendees: string[];
  status: "scheduled" | "started" | "cancelled";
  reminded: boolean;
}
export function selectWinners(
  entrants: readonly string[],
  count: number,
  random: (max: number) => number = (max) => randomInt(max),
): string[] {
  assert(Number.isSafeInteger(count) && count >= 1 && count <= 20);
  const pool = [...new Set(entrants)],
    winners: string[] = [];
  while (pool.length && winners.length < count) {
    const index = random(pool.length);
    assert(Number.isInteger(index) && index >= 0 && index < pool.length);
    winners.push(pool[index]!);
    pool.splice(index, 1);
  }
  return winners;
}
export function qualifies(
  eligibility: Eligibility,
  member: {
    bot: boolean;
    joinedGuild: boolean;
    roles: string[];
    created: number;
    level: number;
  },
  now = Date.now(),
): boolean {
  return (
    !member.bot &&
    member.joinedGuild &&
    (!eligibility.roleId || member.roles.includes(eligibility.roleId)) &&
    now - member.created >= eligibility.minAccountDays * 86400000 &&
    member.level >= eligibility.minLevel
  );
}
export class GiveawayService {
  constructor(
    readonly db: Store,
    readonly now: () => number = Date.now,
  ) {}
  create(
    input: Omit<Giveaway, "id" | "entrants" | "status" | "rounds">,
  ): Giveaway {
    assert(
      input.ends > this.now() &&
        Number.isSafeInteger(input.winnerCount) &&
        input.winnerCount >= 1 &&
        input.winnerCount <= 20,
    );
    assert(input.prize.trim().length >= 1 && input.prize.length <= 200);
    assert(
      input.eligibility.minAccountDays >= 0 && input.eligibility.minLevel >= 0,
    );
    const result: Giveaway = {
      ...input,
      id: randomUUID().slice(0, 16),
      entrants: [],
      status: "active",
      rounds: [],
    };
    this.db.set(input.guild, "giveaways", result.id, result);
    return result;
  }
  get(guild: string, id: string): Giveaway {
    const result = this.db.get<Giveaway>(guild, "giveaways", id);
    assert(result, "error.expired");
    return result;
  }
  bind(guild: string, id: string, message: string): void {
    const result = this.get(guild, id);
    result.message = message;
    this.db.set(guild, "giveaways", id, result);
  }
  join(
    guild: string,
    id: string,
    user: string,
    eligible: boolean,
    maxEntries = 1000,
  ): Giveaway {
    assert(
      Number.isSafeInteger(maxEntries) &&
        maxEntries >= 2 &&
        maxEntries <= 100000,
    );
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(s.status === "active" && s.ends > this.now(), "error.expired");
      assert(eligible, "community.ineligible");
      assert(
        s.entrants.length < maxEntries || s.entrants.includes(user),
        "community.full",
      );
      if (!s.entrants.includes(user)) s.entrants.push(user);
      this.db.set(guild, "giveaways", id, s);
      return s;
    });
  }
  leave(guild: string, id: string, user: string): Giveaway {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(s.status === "active" && s.ends > this.now(), "error.expired");
      s.entrants = s.entrants.filter((id) => id !== user);
      this.db.set(guild, "giveaways", id, s);
      return s;
    });
  }
  finish(
    guild: string,
    id: string,
    eligible: string[],
    reroll = false,
  ): Giveaway {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      if (s.status === "ended" && !reroll) return s;
      assert(
        reroll ? s.status === "ended" : s.ends <= this.now(),
        "error.input",
      );
      const excluded = new Set(s.rounds.flatMap((r) => r.winners));
      const pool = s.entrants.filter(
        (user) => eligible.includes(user) && !excluded.has(user),
      );
      const winners = selectWinners(pool, s.winnerCount);
      if (reroll) assert(winners.length > 0, "community.noWinners");
      s.rounds.push({ at: this.now(), winners });
      s.status = "ended";
      this.db.set(guild, "giveaways", id, s);
      return s;
    });
  }
}
export class PollService {
  constructor(
    readonly db: Store,
    readonly now: () => number = Date.now,
  ) {}
  create(input: Omit<Poll, "id" | "votes" | "status">): Poll {
    assert(
      input.ends > this.now() &&
        input.question.length >= 1 &&
        input.question.length <= 200,
    );
    assert(
      input.options.length >= 2 &&
        input.options.length <= 10 &&
        input.options.every((o) => o.length >= 1 && o.length <= 80),
    );
    assert(new Set(input.options).size === input.options.length);
    const result: Poll = {
      ...input,
      id: randomUUID().slice(0, 16),
      votes: {},
      status: "active",
    };
    this.db.set(input.guild, "polls", result.id, result);
    return result;
  }
  get(guild: string, id: string): Poll {
    const result = this.db.get<Poll>(guild, "polls", id);
    assert(result, "error.expired");
    return result;
  }
  bind(guild: string, id: string, message: string): void {
    const result = this.get(guild, id);
    result.message = message;
    this.db.set(guild, "polls", id, result);
  }
  vote(guild: string, id: string, user: string, option: number): Poll {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(s.status === "active" && s.ends > this.now(), "error.expired");
      assert(
        Number.isInteger(option) && option >= 0 && option < s.options.length,
      );
      assert(
        s.changeVotes ||
          s.votes[user] === undefined ||
          s.votes[user] === option,
        "community.voteFixed",
      );
      assert(
        Object.keys(s.votes).length < 10000 || s.votes[user] !== undefined,
        "community.full",
      );
      s.votes[user] = option;
      this.db.set(guild, "polls", id, s);
      return s;
    });
  }
  finish(guild: string, id: string): Poll {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(s.ends <= this.now());
      s.status = "ended";
      this.db.set(guild, "polls", id, s);
      return s;
    });
  }
}
export class EventService {
  constructor(
    readonly db: Store,
    readonly now: () => number = Date.now,
  ) {}
  create(
    input: Omit<CommunityEvent, "id" | "attendees" | "status" | "reminded">,
  ): CommunityEvent {
    assert(
      input.starts > this.now() &&
        input.title.length >= 1 &&
        input.title.length <= 200 &&
        input.description.length <= 1500,
    );
    const result: CommunityEvent = {
      ...input,
      id: randomUUID().slice(0, 16),
      attendees: [],
      status: "scheduled",
      reminded: false,
    };
    this.db.set(input.guild, "events", result.id, result);
    return result;
  }
  get(guild: string, id: string): CommunityEvent {
    const result = this.db.get<CommunityEvent>(guild, "events", id);
    assert(result, "error.expired");
    return result;
  }
  bind(guild: string, id: string, message: string): void {
    const result = this.get(guild, id);
    result.message = message;
    this.db.set(guild, "events", id, result);
  }
  rsvp(guild: string, id: string, user: string, join: boolean): CommunityEvent {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(
        s.status === "scheduled" && s.starts > this.now(),
        "error.expired",
      );
      assert(
        s.attendees.length < 1000 || s.attendees.includes(user) || !join,
        "community.full",
      );
      s.attendees = s.attendees.filter((id) => id !== user);
      if (join) s.attendees.push(user);
      this.db.set(guild, "events", id, s);
      return s;
    });
  }
  cancel(guild: string, id: string): CommunityEvent {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      assert(s.status === "scheduled");
      s.status = "cancelled";
      this.db.set(guild, "events", id, s);
      return s;
    });
  }
  markReminder(guild: string, id: string): CommunityEvent {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      s.reminded = true;
      this.db.set(guild, "events", id, s);
      return s;
    });
  }
  start(guild: string, id: string): CommunityEvent {
    return this.db.transaction(() => {
      const s = this.get(guild, id);
      if (s.status === "scheduled") {
        assert(s.starts <= this.now());
        s.status = "started";
        this.db.set(guild, "events", id, s);
      }
      return s;
    });
  }
}
