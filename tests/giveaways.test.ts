import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/database/store.js";
import {
  GiveawayService,
  PollService,
  EventService,
  qualifies,
  selectWinners,
  type Giveaway,
} from "../src/modules/giveaways/service.js";
import {
  renderGiveaway,
  renderPoll,
  renderEvent,
} from "../src/modules/giveaways/render.js";
import { giveawaysModule } from "../src/modules/giveaways/index.js";
import { Registry } from "../src/core/registry.js";
import { Scheduler } from "../src/core/scheduler.js";
import { Settings } from "../src/core/settings.js";
import type { Runtime, CommandContext } from "../src/core/types.js";
import { pino } from "pino";
let db: Store,
  clock: number,
  giveaways: GiveawayService,
  polls: PollService,
  events: EventService;
const base = { guild: "guild", channel: "channel", organizer: "organizer" };
beforeEach(() => {
  db = new Store(":memory:");
  clock = 1_000_000;
  giveaways = new GiveawayService(db, () => clock);
  polls = new PollService(db, () => clock);
  events = new EventService(db, () => clock);
});
afterEach(() => db?.close());
function giveaway() {
  return giveaways.create({
    ...base,
    prize: "A virtual badge",
    ends: clock + 60000,
    winnerCount: 2,
    eligibility: { minAccountDays: 0, minLevel: 0 },
  });
}
function poll(changeVotes = true) {
  return polls.create({
    ...base,
    question: "Choose a day",
    options: ["Monday", "Friday"],
    ends: clock + 60000,
    changeVotes,
  });
}
function event() {
  return events.create({
    ...base,
    title: "Community evening",
    description: "Play local games together.",
    starts: clock + 60000,
  });
}
describe("giveaways and community events", () => {
  it("persists unique entrants and supports leave/join without duplication", () => {
    const s = giveaway();
    giveaways.join(s.guild, s.id, "alice", true);
    giveaways.join(s.guild, s.id, "alice", true);
    expect(giveaways.get(s.guild, s.id).entrants).toEqual(["alice"]);
    giveaways.leave(s.guild, s.id, "alice");
    giveaways.leave(s.guild, s.id, "alice");
    expect(giveaways.get(s.guild, s.id).entrants).toEqual([]);
  });
  it("validates eligibility and prevents entries after the deadline", () => {
    const s = giveaway();
    expect(() => giveaways.join(s.guild, s.id, "alice", false)).toThrow(
      "community.ineligible",
    );
    clock = s.ends;
    expect(() => giveaways.join(s.guild, s.id, "alice", true)).toThrow(
      "error.expired",
    );
    expect(() => giveaways.leave(s.guild, s.id, "alice")).toThrow(
      "error.expired",
    );
  });
  it("checks current role, account age, level, bot state and guild membership", () => {
    const rules = { roleId: "role", minAccountDays: 7, minLevel: 3 };
    const member = {
      bot: false,
      joinedGuild: true,
      roles: ["role"],
      created: 0,
      level: 3,
    };
    const now = 8 * 86400000;
    expect(qualifies(rules, member, now)).toBe(true);
    expect(qualifies(rules, { ...member, bot: true }, now)).toBe(false);
    expect(qualifies(rules, { ...member, joinedGuild: false }, now)).toBe(
      false,
    );
    expect(qualifies(rules, { ...member, roles: [] }, now)).toBe(false);
    expect(qualifies(rules, { ...member, level: 2 }, now)).toBe(false);
    expect(qualifies(rules, { ...member, created: now - 86400000 }, now)).toBe(
      false,
    );
  });
  it("selects unique winners and revalidates entrants at closing time", () => {
    const s = giveaway();
    for (const user of ["alice", "bob", "carol"])
      giveaways.join(s.guild, s.id, user, true);
    clock = s.ends;
    const result = giveaways.finish(s.guild, s.id, [
      "alice",
      "carol",
      "outsider",
    ]);
    expect(new Set(result.rounds[0]!.winners)).toEqual(
      new Set(["alice", "carol"]),
    );
    expect(result.rounds[0]!.winners).not.toContain("outsider");
  });
  it("never draws twice when a finalization job retries", () => {
    const s = giveaway();
    giveaways.join(s.guild, s.id, "alice", true);
    clock = s.ends;
    const first = giveaways.finish(s.guild, s.id, ["alice"]);
    const retry = giveaways.finish(s.guild, s.id, ["bob"]);
    expect(retry).toEqual(first);
    expect(retry.rounds.length).toBe(1);
  });
  it("excludes every prior winner from rerolls and retains round history", () => {
    const s = giveaway();
    for (const user of ["alice", "bob", "carol", "dave"])
      giveaways.join(s.guild, s.id, user, true);
    clock = s.ends;
    const first = giveaways.finish(s.guild, s.id, ["alice", "bob"]);
    const second = giveaways.finish(
      s.guild,
      s.id,
      ["alice", "bob", "carol", "dave"],
      true,
    );
    expect(second.rounds[0]).toEqual(first.rounds[0]);
    expect(new Set(second.rounds[1]!.winners)).toEqual(
      new Set(["carol", "dave"]),
    );
    expect(() =>
      giveaways.finish(s.guild, s.id, ["alice", "bob", "carol", "dave"], true),
    ).toThrow("community.noWinners");
  });
  it("finishes safely with no eligible participants", () => {
    const s = giveaway();
    clock = s.ends;
    expect(giveaways.finish(s.guild, s.id, []).rounds[0]!.winners).toEqual([]);
  });
  it("uses unbiased index selection without replacement and deduplicates the candidate pool", () => {
    expect(
      selectWinners(["alice", "alice", "bob", "carol"], 3, () => 0),
    ).toEqual(["alice", "bob", "carol"]);
    expect(
      selectWinners(["alice", "bob", "carol"], 2, (max) => max - 1),
    ).toEqual(["carol", "bob"]);
    expect(() => selectWinners(["alice"], 21)).toThrow();
    expect(() => selectWinners(["alice"], 1, () => -1)).toThrow();
  });
  it("keeps giveaway data isolated between guilds", () => {
    const s = giveaway();
    expect(() => giveaways.get("different-guild", s.id)).toThrow(
      "error.expired",
    );
    expect(db.list("different-guild", "giveaways")).toEqual([]);
  });
  it("tracks one vote per person and permits configured vote changes", () => {
    const s = poll();
    polls.vote(s.guild, s.id, "alice", 0);
    polls.vote(s.guild, s.id, "alice", 1);
    polls.vote(s.guild, s.id, "bob", 1);
    expect(polls.get(s.guild, s.id).votes).toEqual({ alice: 1, bob: 1 });
    expect(() => polls.vote(s.guild, s.id, "carol", 2)).toThrow();
  });
  it("prevents changes when votes are fixed, allows safe retries, and closes at the deadline", () => {
    const s = poll(false);
    polls.vote(s.guild, s.id, "alice", 0);
    polls.vote(s.guild, s.id, "alice", 0);
    expect(() => polls.vote(s.guild, s.id, "alice", 1)).toThrow(
      "community.voteFixed",
    );
    clock = s.ends;
    expect(() => polls.vote(s.guild, s.id, "bob", 1)).toThrow("error.expired");
    expect(polls.finish(s.guild, s.id).status).toBe("ended");
  });
  it("tracks event RSVPs without duplicates and blocks cancelled events", () => {
    const s = event();
    events.rsvp(s.guild, s.id, "alice", true);
    events.rsvp(s.guild, s.id, "alice", true);
    expect(events.get(s.guild, s.id).attendees).toEqual(["alice"]);
    events.rsvp(s.guild, s.id, "alice", false);
    expect(events.get(s.guild, s.id).attendees).toEqual([]);
    events.cancel(s.guild, s.id);
    expect(() => events.rsvp(s.guild, s.id, "bob", true)).toThrow(
      "error.expired",
    );
    clock = s.starts;
    expect(events.start(s.guild, s.id).status).toBe("cancelled");
  });
  it("persists reminder flags and starts scheduled events once", () => {
    const s = event();
    expect(events.markReminder(s.guild, s.id).reminded).toBe(true);
    expect(() => events.start(s.guild, s.id)).toThrow();
    clock = s.starts;
    expect(events.start(s.guild, s.id).status).toBe("started");
    expect(events.start(s.guild, s.id).status).toBe("started");
  });
  it("restores giveaway entries, poll votes and RSVP lists after a restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "executive-community-"));
    const file = join(directory, "data.sqlite");
    try {
      let durable = new Store(file);
      let service = new GiveawayService(durable, () => clock);
      const s = service.create({
        ...base,
        prize: "Badge",
        ends: clock + 60000,
        winnerCount: 1,
        eligibility: { minAccountDays: 0, minLevel: 0 },
      });
      service.join(s.guild, s.id, "alice", true);
      const p = new PollService(durable, () => clock).create({
        ...base,
        question: "Day?",
        options: ["A", "B"],
        ends: clock + 60000,
        changeVotes: true,
      });
      new PollService(durable, () => clock).vote(p.guild, p.id, "alice", 1);
      const e = new EventService(durable, () => clock).create({
        ...base,
        title: "Meet",
        description: "",
        starts: clock + 60000,
      });
      new EventService(durable, () => clock).rsvp(e.guild, e.id, "alice", true);
      durable.close();
      durable = new Store(file);
      service = new GiveawayService(durable, () => clock);
      expect(service.get(s.guild, s.id).entrants).toEqual(["alice"]);
      expect(
        new PollService(durable, () => clock).get(p.guild, p.id).votes.alice,
      ).toBe(1);
      expect(
        new EventService(durable, () => clock).get(e.guild, e.id).attendees,
      ).toEqual(["alice"]);
      clock = s.ends;
      expect(
        service.finish(s.guild, s.id, ["alice"]).rounds[0]!.winners,
      ).toEqual(["alice"]);
      durable.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("renders both languages, disables ended buttons, and suppresses mass mentions", () => {
    let g = giveaway();
    const p = poll();
    const e = event();
    clock = g.ends;
    g = giveaways.finish(g.guild, g.id, []);
    for (const locale of ["tr", "en"] as const) {
      const views = [
        renderGiveaway(g, locale),
        renderPoll(p, locale),
        renderEvent(e, locale),
      ];
      for (const view of views) {
        expect(view.allowedMentions).toEqual({ parse: [] });
        expect(JSON.stringify(view)).not.toContain("undefined");
      }
      expect(
        JSON.parse(JSON.stringify(renderGiveaway(g, locale).components?.[0])),
      ).toMatchObject({ components: [{ disabled: true }, { disabled: true }] });
    }
  });
  it("validates giveaway bounds before storing data", () => {
    expect(() =>
      giveaways.create({
        ...base,
        prize: "",
        ends: clock + 1,
        winnerCount: 0,
        eligibility: { minAccountDays: 0, minLevel: 0 },
      }),
    ).toThrow();
    expect(db.list<Giveaway>(base.guild, "giveaways")).toEqual([]);
  });
  it("acknowledges slash commands that create public community messages", async () => {
    const settings = new Settings(db),
      registry = new Registry(),
      logger = pino({ level: "silent" }),
      scheduler = new Scheduler(db, settings, logger);
    const runtime = {
      db,
      settings,
      registry,
      logger,
      scheduler,
      interactions: new Map(),
    } as unknown as Runtime;
    giveawaysModule.register(runtime);
    const reply = vi.fn().mockResolvedValue(undefined),
      send = vi.fn().mockResolvedValue({ id: "message" });
    const ctx = {
      runtime,
      guild: { id: "guild" },
      user: { id: "organizer" },
      channel: { id: "channel", isSendable: () => true, send },
      locale: "en",
      args: ["1h", "1", "Badge"],
      reply,
    } as unknown as CommandContext;
    await registry.find("giveaway")!.execute(ctx);
    ctx.args = ["1h", "Day?", "|", "Monday", "|", "Friday"];
    await registry.find("anket")!.execute(ctx);
    ctx.args = ["1h", "Community", "evening", "|", "Play", "games"];
    await registry.find("etkinlik")!.execute(ctx);
    expect(reply).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(db.list("guild", "jobs")).toHaveLength(4);
  });
});
