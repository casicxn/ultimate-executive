import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "discord.js";
import type { ComponentInteraction } from "../src/core/types.js";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import { createRuntime } from "../src/core/runtime.js";
import {
  SocialService,
  nextBirthday,
  parseBirthday,
  type Reminder,
} from "../src/modules/social/service.js";
import { socialModule } from "../src/modules/social/index.js";
let db: Store, social: SocialService;
beforeEach(() => {
  db = new Store(":memory:");
  social = new SocialService(db, new Settings(db));
});
afterEach(() => {
  db?.close();
  vi.restoreAllMocks();
});
describe("consent-based social records", () => {
  it("requires recipient consent and prevents outsider/proposer acceptance", () => {
    const p = social.propose("g", "alice", "bob", 1000);
    expect(social.partner("g", "alice")).toBeUndefined();
    expect(() => social.answer("g", p.id, "alice", true, 1001)).toThrow(
      "error.permission",
    );
    expect(() => social.answer("g", p.id, "mallory", true, 1001)).toThrow(
      "error.permission",
    );
    social.answer("g", p.id, "bob", true, 1001);
    expect(social.partner("g", "alice")?.partner).toBe("bob");
    expect(social.partner("g", "bob")?.partner).toBe("alice");
    expect(() => social.answer("g", p.id, "bob", true, 1002)).toThrow(
      "error.expired",
    );
  });
  it("rejects self proposals, expired proposals, duplicates and forced second marriages", () => {
    expect(() => social.propose("g", "a", "a", 1000)).toThrow("social.self");
    const p = social.propose("g", "a", "b", 1000);
    expect(() => social.propose("g", "c", "b", 1001)).toThrow("social.pending");
    expect(() => social.answer("g", p.id, "b", true, 121001)).toThrow(
      "error.expired",
    );
    const next = social.propose("g", "a", "b", 121002);
    social.answer("g", next.id, "b", true, 121003);
    expect(() => social.propose("g", "a", "c", 121004)).toThrow(
      "social.alreadyMarried",
    );
  });
  it("allows explicit rejection, guild-specific relationships and reciprocal divorce", () => {
    const p = social.propose("g", "a", "b", 1000);
    social.answer("g", p.id, "b", false, 1001);
    expect(social.partner("g", "a")).toBeUndefined();
    const p2 = social.propose("g", "a", "b", 1002);
    social.answer("g", p2.id, "b", true, 1003);
    expect(social.partner("other", "a")).toBeUndefined();
    social.divorce("g", "b");
    expect(social.partner("g", "a")).toBeUndefined();
    expect(social.partner("g", "b")).toBeUndefined();
  });
  it("prevents self reputation and repeated farming while accepting idempotent replay", () => {
    expect(() => social.reputation("g", "a", "a", "self", 1000)).toThrow(
      "social.repSelf",
    );
    expect(social.reputation("g", "a", "b", "rep:1", 1000)).toBe(1);
    expect(social.reputation("g", "a", "b", "rep:1", 1001)).toBe(1);
    expect(() => social.reputation("g", "a", "c", "rep:2", 1002)).toThrow(
      "error.cooldown",
    );
    expect(social.reputation("other", "a", "b", "rep:2", 1002)).toBe(1);
  });
  it("persists marriages and reputation cooldowns after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "executive-social-"));
    let persistent: Store | undefined;
    try {
      const path = join(dir, "data.sqlite");
      persistent = new Store(path);
      let svc = new SocialService(persistent, new Settings(persistent));
      const p = svc.propose("g", "a", "b", 1000);
      svc.answer("g", p.id, "b", true, 1001);
      svc.reputation("g", "a", "b", "rep", 1000);
      persistent.close();
      persistent = new Store(path);
      svc = new SocialService(persistent, new Settings(persistent));
      expect(svc.partner("g", "a")?.partner).toBe("b");
      expect(svc.profile("g", "b").rep).toBe(1);
      expect(() => svc.reputation("g", "a", "c", "rep2", 1001)).toThrow(
        "error.cooldown",
      );
    } finally {
      persistent?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("validates optional birthdays without storing birth years and schedules leap days safely", () => {
    expect(parseBirthday("29-02")).toEqual({ day: 29, month: 2 });
    expect(() => parseBirthday("31-04")).toThrow();
    expect(() => parseBirthday("01-13")).toThrow();
    const next = new Date(nextBirthday(29, 2, Date.UTC(2025, 0, 1)));
    expect(next.getUTCFullYear()).toBe(2028);
    expect(next.getUTCMonth()).toBe(1);
    expect(next.getUTCDate()).toBe(29);
  });
  it("delivers a persisted reminder once, sanitizes mentions, and records closed-DM failures", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    socialModule.register(runtime);
    const send = vi.fn().mockResolvedValue({ id: "message" });
    vi.spyOn(runtime.client.users, "fetch").mockResolvedValue({
      send,
    } as unknown as User);
    const reminder: Reminder = {
      id: "12345678-1234-1234-1234-123456789012",
      user: "alice",
      text: "test",
      due: 1,
      status: "pending",
      channel: "channel",
    };
    runtime.db.set("g", "reminders", reminder.id, reminder);
    runtime.scheduler.schedule(
      "g",
      "social",
      "social.reminder",
      1,
      { id: reminder.id },
      "job",
    );
    try {
      await runtime.scheduler.tick(1000);
      await runtime.scheduler.tick(2000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        allowedMentions: { parse: [] },
        enforceNonce: true,
      });
      expect(
        runtime.db.get<Reminder>("g", "reminders", reminder.id)?.status,
      ).toBe("sent");
      send.mockRejectedValueOnce(
        Object.assign(new Error("DM closed"), { code: 50007 }),
      );
      const second = { ...reminder, id: "closed" };
      runtime.db.set("g", "reminders", second.id, second);
      runtime.scheduler.schedule(
        "g",
        "social",
        "social.reminder",
        1,
        { id: second.id },
        "job2",
      );
      await runtime.scheduler.tick(3000);
      expect(
        runtime.db.get<Reminder>("g", "reminders", second.id)?.status,
      ).toBe("failed");
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
  it("acknowledges authorized marriage buttons once and never updates the proposal for outsiders", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    socialModule.register(runtime);
    const svc = new SocialService(runtime.db, runtime.settings);
    const p = svc.propose("g", "a", "b");
    const update = vi.fn().mockResolvedValue(undefined);
    const handler = runtime.interactions.get("social")!.handle;
    const interaction = (user: string) =>
      ({
        isButton: () => true,
        guildId: "g",
        customId: `social:marry:${p.id}:yes`,
        user: { id: user },
        update,
      }) as unknown as ComponentInteraction;
    try {
      await expect(handler(interaction("outsider"), runtime)).rejects.toThrow(
        "error.permission",
      );
      expect(update).not.toHaveBeenCalled();
      await handler(interaction("b"), runtime);
      expect(update).toHaveBeenCalledTimes(1);
      expect(svc.partner("g", "a")?.partner).toBe("b");
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
  it("rejects an old divorce confirmation after the member has remarried", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    socialModule.register(runtime);
    const svc = new SocialService(runtime.db, runtime.settings);
    const first = svc.propose("g", "a", "b");
    svc.answer("g", first.id, "b", true);
    runtime.db.set("g", "divorceConfirmations", "old", {
      user: "a",
      proposal: first.id,
      expires: Date.now() + 60000,
    });
    svc.divorce("g", "a");
    const second = svc.propose("g", "a", "c");
    svc.answer("g", second.id, "c", true);
    const update = vi.fn();
    const interaction = {
      isButton: () => true,
      guildId: "g",
      customId: "social:divorce:old:yes",
      user: { id: "a" },
      update,
    } as unknown as ComponentInteraction;
    try {
      await expect(
        runtime.interactions.get("social")!.handle(interaction, runtime),
      ).rejects.toThrow("error.expired");
      expect(update).not.toHaveBeenCalled();
      expect(svc.partner("g", "a")?.partner).toBe("c");
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
  it("keeps transiently failed reminders pending and retries them with the same nonce", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    socialModule.register(runtime);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ id: "sent" });
    vi.spyOn(runtime.client.users, "fetch").mockResolvedValue({
      send,
    } as unknown as User);
    const reminder: Reminder = {
      id: "retry-reminder",
      user: "a",
      text: "hello",
      due: 1,
      status: "pending",
      channel: "c",
    };
    runtime.db.set("g", "reminders", reminder.id, reminder);
    runtime.scheduler.schedule(
      "g",
      "social",
      "social.reminder",
      1,
      { id: reminder.id },
      "retry-job",
    );
    try {
      await runtime.scheduler.tick(1000);
      expect(
        runtime.db.get<Reminder>("g", "reminders", reminder.id)?.status,
      ).toBe("pending");
      await runtime.scheduler.tick(22000);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]?.[0].nonce).toBe(send.mock.calls[1]?.[0].nonce);
      expect(
        runtime.db.get<Reminder>("g", "reminders", reminder.id)?.status,
      ).toBe("sent");
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
});
