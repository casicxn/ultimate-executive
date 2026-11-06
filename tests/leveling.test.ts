import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  type Guild,
  type Message,
  type VoiceState,
} from "discord.js";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import {
  LevelingService,
  levelFor,
  levelProgress,
} from "../src/modules/leveling/service.js";
import {
  levelingModule,
  voiceEligible,
} from "../src/modules/leveling/index.js";
import { renderRankCard } from "../src/modules/leveling/rank-card.js";
import { createRuntime } from "../src/core/runtime.js";
let db: Store, service: LevelingService;
beforeEach(() => {
  db = new Store(":memory:");
  service = new LevelingService(db, new Settings(db));
});
afterEach(() => {
  db?.close();
  vi.restoreAllMocks();
});
describe("XP anti-abuse and progression", () => {
  it("has deterministic level boundaries and progress", () => {
    expect(levelFor(99)).toBe(0);
    expect(levelFor(100)).toBe(1);
    expect(levelFor(399)).toBe(1);
    expect(levelFor(400)).toBe(2);
    expect(levelProgress(250)).toEqual({
      level: 1,
      current: 150,
      needed: 300,
      fraction: 0.5,
    });
  });
  it("awards each message only once and respects cooldown", () => {
    service.message("g", "a", "hash1", "m1", 100000);
    expect(service.message("g", "a", "hash2", "m2", 100001)).toBeUndefined();
    expect(service.message("g", "a", "hash2", "m1", 200000)).toBeUndefined();
    expect(service.profile("g", "a")).toEqual({
      xp: 15,
      messages: 1,
      voiceTicks: 0,
    });
    service.message("g", "a", "hash2", "m2", 200000);
    expect(service.profile("g", "a").xp).toBe(30);
  });
  it("rejects repeated content across cooldown periods and isolates guilds", () => {
    service.message("g", "a", "same", "m1", 100000);
    expect(service.message("g", "a", "same", "m2", 200000)).toBeUndefined();
    service.message("other", "a", "same", "m3", 200000);
    expect(service.profile("other", "a").xp).toBe(15);
  });
  it("prevents negative/overflow XP and duplicate voice rewards", () => {
    expect(() => service.award("g", "a", -1, "bad")).toThrow();
    expect(() =>
      service.award("g", "a", Number.MAX_SAFE_INTEGER, "bad"),
    ).toThrow();
    service.voice("g", "a", "minute:1");
    service.voice("g", "a", "minute:1");
    expect(service.profile("g", "a")).toEqual({
      xp: 10,
      messages: 0,
      voiceTicks: 1,
    });
  });
  it("requires at least two active humans in voice and excludes idle users", () => {
    const makeMember = (id: string, bot = false, mute = false) => ({
      id,
      user: { bot },
      roles: { cache: new Collection() },
      voice: {
        selfMute: mute,
        serverMute: false,
        selfDeaf: false,
        serverDeaf: false,
      },
    });
    const alice = makeMember("a"),
      bob = makeMember("b");
    const members = new Collection([
      ["a", alice],
      ["b", bob],
    ]);
    const state = {
      member: alice,
      channel: { id: "voice", members },
      guild: { afkChannelId: null },
      selfMute: false,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
    } as unknown as VoiceState;
    expect(voiceEligible(state, [], [])).toBe(true);
    expect(voiceEligible(state, ["voice"], [])).toBe(false);
    bob.voice.selfMute = true;
    expect(voiceEligible(state, [], [])).toBe(false);
    bob.voice.selfMute = false;
    bob.user.bot = true;
    expect(voiceEligible(state, [], [])).toBe(false);
    bob.user.bot = false;
    state.selfDeaf = true;
    expect(voiceEligible(state, [], [])).toBe(false);
  });
  it("renders a real PNG rank card without external avatar access", async () => {
    const bytes = await renderRankCard({
      username: "Casi",
      avatar: "",
      xp: 250,
      rank: 1,
      accent: "#5865f2",
      background: "#111827",
      locale: "tr",
    });
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(900);
    expect(bytes.readUInt32BE(20)).toBe(280);
  });
  it("does not award XP for bot messages, webhooks, commands, or excluded channels", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    levelingModule.register(runtime);
    const hook = runtime.messageHooks.find(
      (r) => r.module === "leveling",
    )!.handle;
    const message = (id: string, patch: Record<string, unknown> = {}) =>
      ({
        id,
        guild: { id: "g" },
        member: { roles: { cache: new Collection() } },
        author: { id: "a", bot: false },
        webhookId: null,
        channelId: "general",
        content: `a useful message ${id}`,
        ...patch,
      }) as unknown as Message;
    try {
      await hook(message("bot", { author: { id: "a", bot: true } }));
      await hook(message("hook", { webhookId: "webhook" }));
      await hook(message("command", { content: ".rank" }));
      runtime.settings.setModuleConfig("g", "leveling", {
        excludedChannels: ["general"],
      });
      await hook(message("excluded"));
      expect(
        new LevelingService(runtime.db, runtime.settings).profile("g", "a").xp,
      ).toBe(0);
      runtime.settings.setModuleConfig("g", "leveling", {});
      await hook(message("valid"));
      expect(
        new LevelingService(runtime.db, runtime.settings).profile("g", "a").xp,
      ).toBe(15);
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
  it("rechecks public-role authorization before an automatic level role grant", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    levelingModule.register(runtime);
    runtime.settings.setModuleConfig("g", "leveling", {
      rewardRoles: { "1": "reward" },
    });
    const role = {
      id: "reward",
      guild: { id: "g", channels: { cache: new Collection() } },
      permissions: { bitfield: 0n },
      position: 1,
      managed: false,
    };
    const add = vi.fn();
    const member = {
      id: "alice",
      roles: { cache: new Collection(), add },
      guild: {
        id: "g",
        members: { me: { roles: { highest: { position: 10 } } } },
        roles: { fetch: vi.fn().mockResolvedValue(role) },
      },
    };
    const guild = {
      members: { fetch: vi.fn().mockResolvedValue(member) },
    } as unknown as Guild;
    runtime.client.guilds.cache.set("g", guild);
    vi.spyOn(runtime.permissions, "canAssignPublicRole").mockResolvedValue(
      false,
    );
    try {
      await runtime.scheduler.handlers.get("leveling.rewards")!({
        id: "level-reward",
        guild: "g",
        module: "leveling",
        type: "leveling.rewards",
        due: 1,
        attempts: 0,
        payload: { user: "alice", before: 0, after: 1 },
      });
      expect(add).not.toHaveBeenCalled();
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
});
