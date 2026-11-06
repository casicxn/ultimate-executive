import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Collection,
  PermissionFlagsBits,
  type GuildMember,
  type Message,
} from "discord.js";
import { Store } from "../src/database/store.js";
import { createRuntime, registerModules } from "../src/core/runtime.js";
import { modules } from "../src/modules/index.js";
import { parsePrefix } from "../src/core/registry.js";
import { routeInteraction, routeMessage } from "../src/core/router.js";
import { translations, t } from "../src/core/localization.js";
import type { CommandContext, Runtime } from "../src/core/types.js";
import { duration, userId } from "../src/shared.js";

const resources: Runtime[] = [];
const dirs: string[] = [];
function runtime(path = ":memory:") {
  const r = createRuntime(path, "owner", "silent");
  resources.push(r);
  return r;
}
afterEach(async () => {
  for (const r of resources.splice(0)) {
    r.scheduler.stop();
    await r.client.destroy();
    if (r.db.sqlite.open) r.db.close();
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function member(guild = "g", id = "member"): GuildMember {
  return {
    id,
    guild: { id: guild, ownerId: "owner" },
    roles: { cache: new Collection() },
    permissions: { has: () => false },
  } as unknown as GuildMember;
}
function context(r: Runtime, guild = "g"): CommandContext {
  const m = member(guild);
  return {
    runtime: r,
    guild: m.guild,
    member: m,
    user: { id: m.id },
    channel: { id: "channel" },
    args: [],
    locale: "tr",
    requestId: "request",
    reply: vi.fn(),
  } as unknown as CommandContext;
}
describe("core routing and registration", () => {
  it("connects every command required by the product specification, including aliases", () => {
    const r = runtime();
    registerModules(r, modules);
    const names =
      "ban unban kick mute unmute sil warn warnings clearwarn jail unjail lock unlock slowmode nick renk cezalar sicil modstats tkm yazitura zar 8ball quiz kelime adamasmaca xox connect4 duello sayi tahmin emoji balance daily weekly work pay shop buy sell inventory use economy rich leaderboard level rank top xp profile profil rep ship evlen bosan partner afk hatirlat dogumgunu bio giveaway cekilis reroll anket etkinlik ticket selfrole suggest embed custom autoresponse announce sticky serverinfo userinfo avatar roleinfo channelinfo ping uptime panel staff config".split(
        " ",
      );
    for (const name of names)
      expect(
        r.registry.find(name),
        `Missing connected command: ${name}`,
      ).toBeDefined();
    expect([...r.interactions.keys()]).toEqual(
      expect.arrayContaining([
        "game",
        "community",
        "ticket",
        "social",
        "panel",
        "role",
        "roleselect",
        "suggest",
      ]),
    );
  });
  it("parses prefix whitespace and aliases without treating plain messages as commands", () => {
    expect(parsePrefix("hello")).toBeUndefined();
    expect(parsePrefix(".  HeLp  a b")).toEqual({
      name: "help",
      args: ["a", "b"],
    });
    expect(parsePrefix(".")).toBeUndefined();
  });
  it("loads every module with unique command aliases and complete descriptions", () => {
    const r = runtime();
    registerModules(r, modules);
    expect(r.registry.all().length).toBeGreaterThan(65);
    for (const c of r.registry.all()) {
      expect(translations()[c.description], c.name).toBeDefined();
      expect(t("tr", c.description)).not.toBe(c.description);
      expect(t("en", c.description)).not.toBe(c.description);
      for (const alias of c.aliases ?? [])
        expect(r.registry.find(alias)).toBe(c);
    }
  });
  it("denies unauthorized attempts before execution and permits explicit guild-scoped grants", async () => {
    const r = runtime(),
      execute = vi.fn();
    r.registry.register({
      name: "ban",
      aliases: ["b"],
      module: "moderation",
      description: "x",
      usage: ".ban",
      permission: "ban",
      execute,
    });
    const ctx = context(r);
    await expect(r.registry.execute("b", ctx)).rejects.toThrow(
      "error.permission",
    );
    expect(execute).not.toHaveBeenCalled();
    r.db.set("g", "grants", "user:member", { commands: ["ban"], groups: [] });
    await expect(r.registry.execute("b", ctx)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    await expect(r.registry.execute("b", context(r, "other"))).rejects.toThrow(
      "error.permission",
    );
  });
  it("enforces disabled commands and modules before business logic", async () => {
    const r = runtime(),
      execute = vi.fn();
    r.registry.register({
      name: "test",
      module: "games",
      description: "x",
      usage: ".test",
      execute,
    });
    r.settings.update("g", { disabledModules: ["games"] });
    await expect(r.registry.execute("test", context(r))).rejects.toThrow(
      "error.disabled",
    );
    r.settings.update("g", { disabledModules: [], disabledCommands: ["test"] });
    await expect(r.registry.execute("test", context(r))).rejects.toThrow(
      "error.disabled",
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("persists cooldowns and rejects duplicate simultaneous command requests", async () => {
    const r = runtime(),
      execute = vi.fn();
    r.registry.register({
      name: "test",
      module: "games",
      description: "x",
      usage: ".test",
      execute,
      cooldown: 100000,
    });
    const results = await Promise.allSettled([
      r.registry.execute("test", context(r)),
      r.registry.execute("test", context(r)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("never grants config through native administrator or command grants", () => {
    const r = runtime(),
      m = member();
    vi.spyOn(m.permissions, "has").mockReturnValue(true);
    r.db.set("g", "grants", "user:member", {
      commands: ["config"],
      groups: [],
    });
    expect(
      r.permissions.can(m, "config", PermissionFlagsBits.Administrator),
    ).toBe(false);
    r.settings.update("g", { configAdmins: ["member"] });
    expect(r.permissions.canConfigure(m)).toBe(true);
    expect(r.permissions.canConfigure(member("other"))).toBe(false);
  });
  it("routes actual prefix commands and suppresses bot/webhook execution", async () => {
    const r = runtime();
    const execute = vi.fn(async (ctx: CommandContext) => ctx.reply("ok"));
    r.registry.register({
      name: "test",
      aliases: ["alias"],
      module: "utilities",
      description: "x",
      usage: ".test",
      execute,
    });
    const m = {
      id: "msg",
      guild: { id: "g" },
      member: member(),
      author: { id: "member", bot: false },
      content: ".alias",
      channel: {},
      reply: vi.fn(async () => undefined),
    } as unknown as Message;
    await routeMessage(r, m);
    expect(execute).toHaveBeenCalledOnce();
    expect(m.reply).toHaveBeenCalledWith({
      content: "ok",
      allowedMentions: { parse: [], repliedUser: false },
    });
    await routeMessage(r, { ...m, webhookId: "webhook" } as Message);
    expect(execute).toHaveBeenCalledOnce();
  });
});
describe("durability and scheduler", () => {
  it("uses real SQLite rollback and preserves migrations plus guild data across restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "executive-"));
    dirs.push(dir);
    const file = join(dir, "bot.sqlite");
    const a = new Store(file);
    a.set("g", "wallet", "u", { balance: 10 });
    expect(() =>
      a.transaction(() => {
        a.set("g", "wallet", "u", { balance: 0 });
        a.set("other", "wallet", "u", { balance: 100 });
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    a.close();
    const b = new Store(file);
    expect(b.get("g", "wallet", "u")).toEqual({ balance: 10 });
    expect(b.get("other", "wallet", "u")).toBeUndefined();
    expect(
      b.sqlite.prepare("select count(*) as count from migrations").get(),
    ).toEqual({ count: 1 });
    b.close();
  });
  it("does not run disabled jobs, resumes retained work, and deduplicates named scheduling", async () => {
    const r = runtime(),
      handler = vi.fn(async () => undefined);
    r.scheduler.register("test", handler);
    r.scheduler.schedule("g", "games", "test", 1, {}, "job");
    r.scheduler.schedule("g", "games", "test", 1, {}, "job");
    r.settings.update("g", { disabledModules: ["games"] });
    await r.scheduler.tick(100);
    expect(handler).not.toHaveBeenCalled();
    expect(r.db.list("g", "jobs")).toHaveLength(1);
    r.settings.update("g", { disabledModules: [] });
    await r.scheduler.tick(100);
    await r.scheduler.tick(100);
    expect(handler).toHaveBeenCalledOnce();
    expect(r.db.list("g", "jobs")).toHaveLength(0);
  });
  it("retains retryable failed jobs with backoff and lease protection", async () => {
    const r = runtime();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue(undefined);
    r.scheduler.register("test", handler);
    r.scheduler.schedule("g", "games", "test", 1, {}, "job");
    await r.scheduler.tick(100);
    expect(r.db.get("g", "jobs", "job")).toMatchObject({
      attempts: 1,
      due: 20100,
    });
    await r.scheduler.tick(1000);
    expect(handler).toHaveBeenCalledOnce();
    await r.scheduler.tick(20100);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(r.db.get("g", "jobs", "job")).toBeUndefined();
  });
  it("recovers leased jobs after restart without firing early", async () => {
    const dir = mkdtempSync(join(tmpdir(), "executive-"));
    dirs.push(dir);
    const file = join(dir, "bot.sqlite"),
      a = runtime(file);
    a.scheduler.schedule("g", "games", "test", 1, {}, "job");
    a.db.close();
    const b = runtime(file),
      handler = vi.fn(async () => undefined);
    b.scheduler.register("test", handler);
    const job = b.db.get<Record<string, unknown>>("g", "jobs", "job")!;
    b.db.set("g", "jobs", "job", { ...job, lease: 500 });
    await b.scheduler.tick(499);
    expect(handler).not.toHaveBeenCalled();
    await b.scheduler.tick(500);
    expect(handler).toHaveBeenCalledOnce();
  });
});
describe("interaction authorization and acknowledgement", () => {
  it("rejects disabled persistent components with an ephemeral acknowledgement", async () => {
    const r = runtime(),
      handle = vi.fn();
    r.interactions.set("game", { module: "games", handle });
    r.settings.update("g", { disabledModules: ["games"] });
    const reply = vi.fn(async () => undefined);
    const i = {
      isRepliable: () => true,
      guildId: "g",
      guild: { id: "g" },
      user: { id: "member" },
      isChatInputCommand: () => false,
      isMessageComponent: () => true,
      isModalSubmit: () => false,
      customId: "game:old",
      reply,
    };
    await routeInteraction(r, i as never);
    expect(handle).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: t("tr", "error.disabled"),
        flags: 64,
      }),
    );
  });
  it("leaves first acknowledgement to modal-capable handlers", async () => {
    const r = runtime(),
      handle = vi.fn(async (i) => {
        await i.reply({ content: "ack" });
      });
    r.interactions.set("x", { module: "games", handle });
    const reply = vi.fn(async () => undefined),
      deferReply = vi.fn();
    const i = {
      isRepliable: () => true,
      guildId: "g",
      guild: { id: "g" },
      user: { id: "member" },
      isChatInputCommand: () => false,
      isMessageComponent: () => true,
      isModalSubmit: () => false,
      customId: "x:button",
      reply,
      deferReply,
    };
    await routeInteraction(r, i as never);
    expect(handle).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
    expect(deferReply).not.toHaveBeenCalled();
  });
  it("rejects untrusted and expired custom component IDs", async () => {
    const r = runtime(),
      reply = vi.fn(async () => undefined);
    const i = {
      isRepliable: () => true,
      guildId: "g",
      guild: { id: "g" },
      user: { id: "member" },
      isChatInputCommand: () => false,
      isMessageComponent: () => true,
      isModalSubmit: () => false,
      customId: "missing:spoof",
      reply,
    };
    await routeInteraction(r, i as never);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: t("tr", "error.expired") }),
    );
  });
});
it("validates durations, timeout maximum and IDs", () => {
  expect(duration("1h")).toBe(3600000);
  expect(() => duration("29d", 28 * 86400000)).toThrow();
  expect(() => duration("-1h")).toThrow();
  expect(() => duration("99999999999999999999w")).toThrow();
  expect(userId("<@123456789012345678>")).toBe("123456789012345678");
  expect(() => userId("NaN")).toThrow();
});
