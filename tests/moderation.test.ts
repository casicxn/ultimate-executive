import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  PermissionFlagsBits,
  PermissionsBitField,
  type GuildMember,
  type Role,
} from "discord.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import { Registry } from "../src/core/registry.js";
import { Permissions } from "../src/core/permissions.js";
import { Scheduler, type Job } from "../src/core/scheduler.js";
import type { Runtime, CommandContext } from "../src/core/types.js";
import { CaseRepository } from "../src/modules/moderation/cases.js";
import {
  ModerationService,
  assertSafeRole,
  type JailState,
} from "../src/modules/moderation/service.js";
import { moderationModule } from "../src/modules/moderation/index.js";
import { duration } from "../src/shared.js";

const stores: Store[] = [];
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});
function store(path = ":memory:"): Store {
  const db = new Store(path);
  stores.push(db);
  return db;
}
function runtime(db = store()): Runtime {
  const settings = new Settings(db);
  const logger = pino({ enabled: false });
  return {
    db,
    settings,
    logger,
    registry: new Registry(),
    permissions: new Permissions(db, settings),
    scheduler: new Scheduler(db, settings, logger),
    client: {
      user: { id: "999999999999999999" },
      channels: { fetch: vi.fn() },
    } as unknown as Runtime["client"],
    ownerId: "888888888888888888",
    startedAt: Date.now(),
    interactions: new Map(),
    messageHooks: [],
    voiceHooks: [],
    memberHooks: [],
  };
}
function context(
  rt: Runtime,
  override: Record<string, unknown> = {},
): CommandContext {
  const target = {
    id: "222222222222222222",
    kickable: true,
    moderatable: true,
    kick: vi.fn(),
    timeout: vi.fn(),
  };
  return {
    runtime: rt,
    guild: {
      id: "111111111111111111",
      ownerId: "777777777777777777",
      members: {
        fetch: vi.fn().mockResolvedValue(target),
        ban: vi.fn(),
        unban: vi.fn(),
      },
      bans: { fetch: vi.fn() },
    },
    member: { id: "333333333333333333" },
    user: { id: "333333333333333333" },
    args: [],
    locale: "tr",
    requestId: "request1",
    channel: { id: "444444444444444444" },
    reply: vi.fn(),
    ...override,
  } as unknown as CommandContext;
}
describe("moderation cases", () => {
  it("deduplicates retried requests and isolates guild sequences", () => {
    const repository = new CaseRepository(store());
    const input = {
      guild: "g1",
      moderator: "m",
      target: "u",
      action: "ban",
      reason: "spam",
      requestId: "r",
    };
    const first = repository.begin(input);
    expect(first.id).toBe("1");
    expect(() => repository.begin(input)).toThrow("mod.duplicate");
    expect(repository.begin({ ...input, guild: "g2" }).id).toBe("1");
    expect(repository.list("g1")).toHaveLength(1);
    expect(repository.auditReason(first)).toContain("case=1 moderator=m");
  });
  it("preserves cases and reversal data after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "executive-case-"));
    const file = join(directory, "db.sqlite");
    try {
      const db = new Store(file);
      const repo = new CaseRepository(db);
      const record = repo.begin({
        guild: "g",
        moderator: "m",
        target: "u",
        action: "warn",
        reason: "spam",
        requestId: "r",
      });
      repo.finish(record, "succeeded");
      repo.reverse("g", record.id, "m2", "2");
      db.close();
      const reopened = new Store(file);
      expect(new CaseRepository(reopened).get("g", "1")).toMatchObject({
        status: "succeeded",
        reversedBy: "m2",
        reversalCase: "2",
      });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("records uncertain network outcomes without replaying API requests", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const ctx = context(rt);
    const action = vi.fn().mockRejectedValue(new Error("socket closed"));
    await expect(
      service.perform(ctx, "ban", "u", "spam", action),
    ).rejects.toThrow("mod.uncertain");
    expect(service.cases.get(ctx.guild.id, "1")?.status).toBe("uncertain");
    await expect(
      service.perform(ctx, "ban", "u", "spam", action),
    ).rejects.toThrow("mod.duplicate");
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("records definitive Discord failures separately", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    await expect(
      service.perform(context(rt), "kick", "u", "reason", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(service.cases.get("111111111111111111", "1")?.status).toBe("failed");
  });
});
describe("moderation command behavior", () => {
  it("uses native timeout and enforces the 28-day limit", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    vi.spyOn(rt.permissions, "assertTarget").mockImplementation(() => {});
    const ctx = context(rt, { args: ["222222222222222222", "1h", "spam"] });
    const target = await ctx.guild.members.fetch("222222222222222222");
    await rt.registry.find("mute")!.execute(ctx);
    expect(target.timeout).toHaveBeenCalledWith(
      3600000,
      expect.stringContaining("moderator=333333333333333333"),
    );
    expect(() => duration("29d", 28 * 86400000)).toThrow();
    expect(rt.registry.find("timeout")?.name).toBe("mute");
  });
  it("allows banning a departed user and persists the expiry job", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    const ctx = context(rt, { args: ["222222222222222222", "1d", "spam"] });
    vi.mocked(ctx.guild.members.fetch).mockRejectedValue(
      Object.assign(new Error("Unknown Member"), { code: 10007 }),
    );
    await rt.registry.find("ban")!.execute(ctx);
    expect(ctx.guild.members.ban).toHaveBeenCalledWith(
      "222222222222222222",
      expect.objectContaining({ deleteMessageSeconds: 0 }),
    );
    expect(rt.db.list(ctx.guild.id, "jobs")).toHaveLength(1);
    expect(rt.db.get(ctx.guild.id, "cases", "1")).toMatchObject({
      status: "succeeded",
      duration: 86400000,
    });
  });
  it("never reverses a later ban belonging to another moderator", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    const ctx = context(rt);
    vi.mocked(ctx.guild.bans.fetch).mockResolvedValue({
      reason: "Manual later ban",
    } as unknown as Awaited<ReturnType<typeof ctx.guild.bans.fetch>>);
    rt.client.guilds = {
      fetch: vi.fn().mockResolvedValue(ctx.guild),
    } as unknown as Runtime["client"]["guilds"];
    await rt.scheduler.handlers.get("moderation.unban")!({
      id: "j",
      guild: ctx.guild.id,
      module: "moderation",
      type: "moderation.unban",
      due: 0,
      payload: { target: "222222222222222222", caseId: "1" },
      attempts: 0,
    });
    expect(ctx.guild.members.unban).not.toHaveBeenCalled();
  });
  it("safely skips old bulk-delete messages through discord.js filtering", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    const bulkDelete = vi.fn().mockResolvedValue(new Collection([["x", {}]]));
    const ctx = context(rt, {
      args: ["50"],
      guild: {
        id: "g",
        channels: { fetch: vi.fn().mockResolvedValue({ id: "c", bulkDelete }) },
      },
    });
    await rt.registry.find("sil")!.execute(ctx);
    expect(bulkDelete).toHaveBeenCalledWith(50, true);
    expect(rt.db.get("g", "cases", "1")).toMatchObject({
      status: "succeeded",
      result: "1",
    });
  });
  it("registers all required moderation commands", () => {
    const rt = runtime();
    moderationModule.register(rt);
    for (const name of [
      "ban",
      "unban",
      "kick",
      "mute",
      "unmute",
      "sil",
      "warn",
      "warnings",
      "clearwarn",
      "jail",
      "unjail",
      "lock",
      "unlock",
      "slowmode",
      "nick",
      "renk",
      "cezalar",
      "sicil",
      "modstats",
    ])
      expect(rt.registry.find(name)).toBeDefined();
  });
  it("restores only recorded safe unchanged roles and preserves other member roles", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const add = vi.fn(),
      remove = vi.fn();
    const roles = new Map([
      [
        "safe",
        {
          id: "safe",
          guild: { id: "g" },
          managed: false,
          permissions: { bitfield: 0n },
          comparePositionTo: () => -1,
        },
      ],
      [
        "changed",
        {
          id: "changed",
          guild: { id: "g" },
          managed: false,
          permissions: { bitfield: PermissionFlagsBits.Administrator },
          comparePositionTo: () => -1,
        },
      ],
    ]);
    const member = {
      id: "u",
      roles: {
        cache: new Collection([
          ["jail", {}],
          ["unrelated", {}],
        ]),
        add,
        remove,
      },
    } as unknown as GuildMember;
    const guild = {
      id: "g",
      ownerId: "owner",
      members: { me: { roles: { highest: {} } } },
      roles: {
        fetch: vi.fn().mockImplementation(async (id: string) => roles.get(id)),
      },
    } as unknown as CommandContext["guild"];
    const state: JailState = {
      caseId: "1",
      target: "u",
      role: "jail",
      removed: [
        { id: "safe", permissions: "0" },
        { id: "changed", permissions: "0" },
      ],
      state: "active",
    };
    rt.db.set("g", "jail", "u", state);
    expect(await service.unjail(guild, member, "mod", "2")).toEqual({
      restored: 1,
      skipped: 1,
    });
    expect(remove).toHaveBeenCalledWith("jail", expect.any(String));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(roles.get("safe"), expect.any(String));
  });
  it("rejects privileged shop-like roles for color and jail configuration", () => {
    const actor = {
      guild: {
        id: "g",
        ownerId: "owner",
        members: { me: { roles: { highest: {} } } },
      },
      id: "mod",
      roles: { highest: {} },
    } as unknown as GuildMember;
    const role = {
      id: "r",
      managed: false,
      permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
      comparePositionTo: () => -1,
    } as unknown as Role;
    expect(() => assertSafeRole(actor, role)).toThrow("mod.roleUnsafe");
  });
});
describe("moderation expiration intent durability", () => {
  it("persists a timed ban case and expiration intent before awaiting the external API", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const ctx = context(rt);
    let observed: Job | undefined;
    await expect(
      service.perform(
        ctx,
        "ban",
        "222222222222222222",
        "spam",
        async () => {
          observed = rt.db.get(
            ctx.guild.id,
            "jobs",
            "ban:222222222222222222:1",
          );
          throw new Error("response lost after Discord accepted the ban");
        },
        60000,
      ),
    ).rejects.toThrow("mod.uncertain");
    expect(observed).toMatchObject({
      module: "moderation",
      type: "moderation.unban",
      payload: { target: "222222222222222222", caseId: "1" },
    });
    expect(
      rt.db.get(ctx.guild.id, "jobs", "ban:222222222222222222:1"),
    ).toBeDefined();
    expect(service.cases.get(ctx.guild.id, "1")?.status).toBe("uncertain");
  });
  it("rolls back the case if the expiration intent cannot be committed and never calls Discord", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const ctx = context(rt);
    const action = vi.fn();
    vi.spyOn(rt.scheduler, "schedule").mockImplementation(() => {
      throw new Error("cannot persist expiration");
    });
    await expect(
      service.perform(ctx, "ban", "222222222222222222", "spam", action, 60000),
    ).rejects.toThrow("cannot persist expiration");
    expect(action).not.toHaveBeenCalled();
    expect(rt.db.list(ctx.guild.id, "cases")).toHaveLength(0);
    expect(rt.db.list(ctx.guild.id, "caseRequests")).toHaveLength(0);
  });
  it("reverses an uncertain timed ban only when the actual Discord audit reason still matches its case", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    const ctx = context(rt, { args: ["222222222222222222", "1h", "spam"] });
    let audit = "";
    vi.mocked(ctx.guild.members.fetch).mockRejectedValue(
      Object.assign(new Error("Unknown Member"), { code: 10007 }),
    );
    vi.mocked(ctx.guild.members.ban).mockImplementation(
      async (_id, options) => {
        audit = options?.reason ?? "";
        throw new Error("response lost");
      },
    );
    await expect(rt.registry.find("ban")!.execute(ctx)).rejects.toThrow(
      "mod.uncertain",
    );
    vi.mocked(ctx.guild.bans.fetch).mockResolvedValue({
      reason: audit,
    } as unknown as Awaited<ReturnType<typeof ctx.guild.bans.fetch>>);
    rt.client.guilds = {
      fetch: vi.fn().mockResolvedValue(ctx.guild),
    } as unknown as Runtime["client"]["guilds"];
    const job = rt.db.list<Job>(ctx.guild.id, "jobs")[0]?.value;
    expect(job).toBeDefined();
    if (!job) throw new Error("Missing expiration intent");
    await rt.scheduler.tick(job.due);
    expect(ctx.guild.members.unban).toHaveBeenCalledOnce();
    expect(rt.db.get(ctx.guild.id, "cases", "1")).toMatchObject({
      status: "uncertain",
      reversedBy: rt.client.user!.id,
    });
  });
  it("persists jail snapshots and expiration together before removing any role", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const role = (id: string) => ({
      id,
      guild: { id: "g" },
      managed: false,
      permissions: new PermissionsBitField(),
      comparePositionTo: () => -1,
    });
    const jailRole = role("jail-role"),
      removedRole = role("safe-role");
    const guild = {
      id: "g",
      ownerId: "owner",
      members: { me: { roles: { highest: {} } } },
      roles: { fetch: vi.fn().mockResolvedValue(jailRole) },
      channels: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            new Collection([["jail-channel", { id: "jail-channel" }]]),
          ),
      },
    } as unknown as CommandContext["guild"];
    const member = {
      id: "333333333333333333",
      guild,
      roles: { highest: {} },
    } as unknown as GuildMember;
    const ctx = context(rt, { guild, member });
    rt.settings.setModuleConfig("g", "jail", {
      role: "jail-role",
      channel: "jail-channel",
      removeRoles: ["safe-role"],
    });
    let snapshot: JailState | undefined;
    let expiration: Job | undefined;
    const remove = vi.fn(async () => {
      snapshot = rt.db.get("g", "jail", "target");
      expiration = rt.db.get("g", "jobs", "jail:target:1");
      throw new Error("role removal response lost");
    });
    const target = {
      id: "target",
      permissions: new PermissionsBitField(),
      roles: {
        cache: new Collection([["safe-role", removedRole]]),
        remove,
        add: vi.fn(),
      },
    } as unknown as GuildMember;
    await expect(
      service.perform(
        ctx,
        "jail",
        target.id,
        "spam",
        (audit, record) => service.jail(ctx, target, record, audit),
        60000,
      ),
    ).rejects.toThrow("mod.uncertain");
    expect(snapshot).toMatchObject({
      caseId: "1",
      state: "applying",
      removed: [{ id: "safe-role", permissions: "0" }],
    });
    expect(expiration).toMatchObject({
      type: "moderation.unjail",
      payload: { target: "target", caseId: "1" },
    });
    expect(rt.db.get("g", "jobs", "jail:target:1")).toBeDefined();
    expect(target.roles.add).not.toHaveBeenCalled();
  });
  it("does not mutate roles when jail expiration persistence fails", async () => {
    const rt = runtime();
    const service = new ModerationService(rt);
    const jailRole = {
      id: "jail-role",
      guild: { id: "g" },
      managed: false,
      permissions: new PermissionsBitField(),
      comparePositionTo: () => -1,
    };
    const guild = {
      id: "g",
      ownerId: "owner",
      members: { me: { roles: { highest: {} } } },
      roles: { fetch: vi.fn().mockResolvedValue(jailRole) },
      channels: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            new Collection([["jail-channel", { id: "jail-channel" }]]),
          ),
      },
    } as unknown as CommandContext["guild"];
    const member = {
      id: "333333333333333333",
      guild,
      roles: { highest: {} },
    } as unknown as GuildMember;
    const ctx = context(rt, { guild, member });
    rt.settings.setModuleConfig("g", "jail", {
      role: "jail-role",
      channel: "jail-channel",
      removeRoles: [],
    });
    const target = {
      id: "target",
      permissions: new PermissionsBitField(),
      roles: { cache: new Collection(), remove: vi.fn(), add: vi.fn() },
    } as unknown as GuildMember;
    vi.spyOn(rt.scheduler, "schedule").mockImplementation(() => {
      throw new Error("cannot persist expiration");
    });
    await expect(
      service.perform(
        ctx,
        "jail",
        target.id,
        "spam",
        (audit, record) => service.jail(ctx, target, record, audit),
        60000,
      ),
    ).rejects.toThrow("mod.uncertain");
    expect(target.roles.remove).not.toHaveBeenCalled();
    expect(target.roles.add).not.toHaveBeenCalled();
    expect(rt.db.get("g", "jail", "target")).toBeUndefined();
  });
  it("keeps a short ban expiration pending while the Discord request is still in flight", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    const ctx = context(rt, { args: ["222222222222222222", "1s", "spam"] });
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let audit = "";
    vi.mocked(ctx.guild.members.fetch).mockRejectedValue(
      Object.assign(new Error("Unknown Member"), { code: 10007 }),
    );
    vi.mocked(ctx.guild.members.ban).mockImplementation(
      async (_id, options) => {
        audit = options?.reason ?? "";
        entered();
        await gate;
        return undefined as never;
      },
    );
    rt.client.guilds = {
      fetch: vi.fn().mockResolvedValue(ctx.guild),
    } as unknown as Runtime["client"]["guilds"];
    vi.mocked(ctx.guild.bans.fetch).mockResolvedValue({
      reason: audit,
    } as never);
    const applying = rt.registry.find("ban")!.execute(ctx);
    await ready;
    const intent = rt.db.list<Job>(ctx.guild.id, "jobs")[0]!.value;
    await rt.scheduler.tick(intent.due);
    expect(ctx.guild.members.unban).not.toHaveBeenCalled();
    expect(rt.client.guilds.fetch).not.toHaveBeenCalled();
    expect(rt.db.get(ctx.guild.id, "jobs", intent.id)).toMatchObject({
      attempts: 1,
    });
    release();
    await applying;
    vi.mocked(ctx.guild.bans.fetch).mockResolvedValue({
      reason: audit,
    } as never);
    const retry = rt.db.get<Job>(ctx.guild.id, "jobs", intent.id)!;
    await rt.scheduler.tick(retry.due);
    expect(ctx.guild.members.unban).toHaveBeenCalledOnce();
    expect(rt.db.get(ctx.guild.id, "cases", "1")).toMatchObject({
      status: "succeeded",
      reversedBy: rt.client.user!.id,
    });
  });
  it("does not release a short jail while its role mutations are still queued", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    vi.spyOn(rt.permissions, "assertTarget").mockImplementation(() => {});
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const role = (id: string) =>
      ({
        id,
        guild: { id: "g" },
        managed: false,
        permissions: new PermissionsBitField(),
        comparePositionTo: () => -1,
      }) as unknown as Role;
    const jailRole = role("jail-role"),
      safeRole = role("safe-role");
    const cache = new Collection([["safe-role", safeRole]]);
    const remove = vi.fn(async (input: Role[] | string) => {
      if (Array.isArray(input)) {
        for (const removed of input) cache.delete(removed.id);
        entered();
        await gate;
      } else cache.delete(input);
    });
    const add = vi.fn(async (input: Role) => {
      cache.set(input.id, input);
    });
    const target = {
      id: "222222222222222222",
      permissions: new PermissionsBitField(),
      roles: { cache, remove, add },
    } as unknown as GuildMember;
    const guild = {
      id: "g",
      ownerId: "owner",
      members: {
        me: { roles: { highest: {} } },
        fetch: vi.fn().mockResolvedValue(target),
      },
      roles: {
        fetch: vi.fn(async (id: string) =>
          id === "jail-role" ? jailRole : safeRole,
        ),
      },
      channels: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            new Collection([["jail-channel", { id: "jail-channel" }]]),
          ),
      },
    } as unknown as CommandContext["guild"];
    const member = {
      id: "333333333333333333",
      guild,
      roles: { highest: {} },
    } as unknown as GuildMember;
    const ctx = context(rt, { guild, member, args: [target.id, "1s", "spam"] });
    rt.settings.setModuleConfig("g", "jail", {
      role: "jail-role",
      channel: "jail-channel",
      removeRoles: ["safe-role"],
    });
    rt.client.guilds = {
      fetch: vi.fn().mockResolvedValue(guild),
    } as unknown as Runtime["client"]["guilds"];
    const applying = rt.registry.find("jail")!.execute(ctx);
    await ready;
    const intent = rt.db.list<Job>("g", "jobs")[0]!.value;
    await rt.scheduler.tick(intent.due);
    expect(rt.db.get("g", "jail", target.id)).toMatchObject({
      state: "applying",
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
    expect(rt.db.get("g", "jobs", intent.id)).toMatchObject({ attempts: 1 });
    release();
    await applying;
    const retry = rt.db.get<Job>("g", "jobs", intent.id)!;
    await rt.scheduler.tick(retry.due);
    expect(cache.has("jail-role")).toBe(false);
    expect(cache.has("safe-role")).toBe(true);
    expect(rt.db.get("g", "jail", target.id)).toBeUndefined();
  });
  it("recovers an applying jail after restart even when its original case remains pending", async () => {
    const rt = runtime();
    moderationModule.register(rt);
    const repository = new CaseRepository(rt.db);
    const record = repository.begin({
      guild: "g",
      moderator: "mod",
      target: "target",
      action: "jail",
      reason: "spam",
      requestId: "crashed-request",
      expires: 1,
    });
    rt.db.set<JailState>("g", "jail", "target", {
      caseId: record.id,
      target: "target",
      role: "jail-role",
      removed: [{ id: "safe-role", permissions: "0" }],
      expires: 1,
      state: "applying",
    });
    rt.scheduler.schedule(
      "g",
      "moderation",
      "moderation.unjail",
      1,
      { target: "target", caseId: record.id },
      "jail:target:1",
    );
    const safeRole = {
      id: "safe-role",
      guild: { id: "g" },
      managed: false,
      permissions: { bitfield: 0n },
      comparePositionTo: () => -1,
    };
    const target = {
      id: "target",
      roles: { cache: new Collection(), remove: vi.fn(), add: vi.fn() },
    } as unknown as GuildMember;
    const guild = {
      id: "g",
      ownerId: "owner",
      members: {
        me: { roles: { highest: {} } },
        fetch: vi.fn().mockResolvedValue(target),
      },
      roles: { fetch: vi.fn().mockResolvedValue(safeRole) },
    } as unknown as CommandContext["guild"];
    rt.client.guilds = {
      fetch: vi.fn().mockResolvedValue(guild),
    } as unknown as Runtime["client"]["guilds"];
    await rt.scheduler.tick(1);
    expect(target.roles.add).toHaveBeenCalledWith(safeRole, expect.any(String));
    expect(rt.db.get("g", "jail", "target")).toBeUndefined();
    expect(repository.get("g", "1")?.reversedAt).toBeDefined();
  });
  it("preserves concurrent reversal details when finishing an older pending case object", () => {
    const repository = new CaseRepository(store());
    const pending = repository.begin({
      guild: "g",
      moderator: "mod",
      target: "target",
      action: "ban",
      reason: "spam",
      requestId: "request",
    });
    repository.reverse("g", pending.id, "system", "expiration:job");
    repository.finish(pending, "succeeded");
    expect(repository.get("g", pending.id)).toMatchObject({
      status: "succeeded",
      reversedBy: "system",
      reversalCase: "expiration:job",
    });
  });
});

function jailAuthorityFixture() {
  const rt = runtime();
  const service = new ModerationService(rt);
  const roles = new Map<string, Role>();
  const edit = vi.fn();
  const channel = {
    id: "jail-channel",
    permissionOverwrites: { edit, cache: new Collection() },
    isTextBased: () => true,
  };
  const guild = {
    id: "g",
    ownerId: "owner",
    members: { me: { roles: { highest: {} } } },
    roles: { fetch: vi.fn(async (id: string) => roles.get(id)) },
    channels: {
      cache: new Collection([[channel.id, channel]]),
      fetch: vi.fn(async (id?: string) =>
        id ? channel : new Collection([[channel.id, channel]]),
      ),
    },
  } as unknown as CommandContext["guild"];
  const role = (id: string) => {
    const result = {
      id,
      guild,
      managed: false,
      permissions: new PermissionsBitField(),
      comparePositionTo: () => -1,
    } as unknown as Role;
    roles.set(id, result);
    return result;
  };
  const jailRole = role("jail-role");
  const safeRole = role("safe-role");
  const member = {
    id: "333333333333333333",
    guild,
    roles: { highest: {} },
  } as unknown as GuildMember;
  const target = {
    id: "target",
    permissions: new PermissionsBitField(),
    roles: {
      cache: new Collection([[safeRole.id, safeRole]]),
      remove: vi.fn(),
      add: vi.fn(),
    },
  } as unknown as GuildMember;
  const ctx = context(rt, { guild, member });
  const config = {
    role: jailRole.id,
    channel: channel.id,
    removeRoles: [safeRole.id],
  };
  rt.settings.setModuleConfig("g", "jail", config);
  const record = service.cases.begin({
    guild: "g",
    moderator: member.id,
    target: target.id,
    action: "jail",
    reason: "spam",
    requestId: "request",
  });
  return {
    rt,
    service,
    guild,
    jailRole,
    safeRole,
    target,
    ctx,
    config,
    record,
    edit,
    overwrites: channel.permissionOverwrites.cache,
  };
}

describe("jail role authority boundaries", () => {
  function giveAuthority(rt: Runtime, roleId: string, kind: string) {
    if (kind === "command")
      rt.db.set("g", "grants", `role:${roleId}`, {
        commands: ["ban"],
        groups: [],
      });
    if (kind === "group") {
      rt.db.set("g", "permissionGroups", "staff", ["warn"]);
      rt.db.set("g", "grants", `role:${roleId}`, {
        commands: [],
        groups: ["staff"],
      });
    }
    if (kind === "protected")
      rt.settings.update("g", { protectedRoles: [roleId] });
    if (kind === "support")
      rt.settings.setModuleConfig("g", "tickets", {
        supportRole: roleId,
        transcript: false,
      });
  }

  it.each(["command", "group", "protected", "support"])(
    "rejects a zero-native-permission jail role with %s authority during setup and use",
    async (kind) => {
      const f = jailAuthorityFixture();
      giveAuthority(f.rt, f.jailRole.id, kind);
      await expect(f.service.setupJail(f.ctx, f.config)).rejects.toThrow(
        "mod.roleUnsafe",
      );
      expect(f.edit).not.toHaveBeenCalled();
      await expect(
        f.service.jail(f.ctx, f.target, f.record, "audit"),
      ).rejects.toThrow("mod.roleUnsafe");
      expect(f.target.roles.remove).not.toHaveBeenCalled();
      expect(f.target.roles.add).not.toHaveBeenCalled();
      expect(f.rt.db.get("g", "jail", f.target.id)).toBeUndefined();
    },
  );

  it("rejects authority-bearing roles in the configured removal whitelist", async () => {
    const f = jailAuthorityFixture();
    giveAuthority(f.rt, f.safeRole.id, "command");
    await expect(f.service.setupJail(f.ctx, f.config)).rejects.toThrow(
      "mod.roleUnsafe",
    );
    expect(f.edit).not.toHaveBeenCalled();
    await expect(
      f.service.jail(f.ctx, f.target, f.record, "audit"),
    ).rejects.toThrow("mod.roleUnsafe");
    expect(f.target.roles.remove).not.toHaveBeenCalled();
  });

  it("rejects a zero-native-permission jail role with channel message-management authority", async () => {
    const f = jailAuthorityFixture();
    f.overwrites.set(f.jailRole.id, {
      allow: new PermissionsBitField(PermissionFlagsBits.ManageMessages),
    });
    await expect(f.service.setupJail(f.ctx, f.config)).rejects.toThrow(
      "mod.roleUnsafe",
    );
    expect(f.edit).not.toHaveBeenCalled();
    await expect(
      f.service.jail(f.ctx, f.target, f.record, "audit"),
    ).rejects.toThrow("mod.roleUnsafe");
    expect(f.target.roles.add).not.toHaveBeenCalled();
    expect(f.target.roles.remove).not.toHaveBeenCalled();
  });

  it("skips restoring a role that acquired channel message-management authority", async () => {
    const f = jailAuthorityFixture();
    f.target.roles.cache.delete(f.safeRole.id);
    f.target.roles.cache.set(f.jailRole.id, f.jailRole);
    f.rt.db.set<JailState>("g", "jail", f.target.id, {
      caseId: f.record.id,
      target: f.target.id,
      role: f.jailRole.id,
      removed: [{ id: f.safeRole.id, permissions: "0" }],
      state: "active",
    });
    f.overwrites.set(f.safeRole.id, {
      allow: new PermissionsBitField(PermissionFlagsBits.ManageMessages),
    });
    expect(
      await f.service.unjail(f.guild, f.target, "mod", "reversal"),
    ).toEqual({ restored: 0, skipped: 1 });
    expect(f.target.roles.add).not.toHaveBeenCalled();
  });

  it.each(["command", "group", "protected", "support"])(
    "skips a previously removed role that gained %s authority before restoration",
    async (kind) => {
      const f = jailAuthorityFixture();
      f.target.roles.cache.delete(f.safeRole.id);
      f.target.roles.cache.set(f.jailRole.id, f.jailRole);
      f.rt.db.set<JailState>("g", "jail", f.target.id, {
        caseId: f.record.id,
        target: f.target.id,
        role: f.jailRole.id,
        removed: [{ id: f.safeRole.id, permissions: "0" }],
        state: "active",
      });
      giveAuthority(f.rt, f.safeRole.id, kind);
      expect(
        await f.service.unjail(f.guild, f.target, "mod", "reversal"),
      ).toEqual({ restored: 0, skipped: 1 });
      expect(f.target.roles.add).not.toHaveBeenCalled();
      expect(f.target.roles.remove).toHaveBeenCalledWith(
        f.jailRole.id,
        expect.any(String),
      );
    },
  );

  it("rechecks authority after role removal returns and refuses an escalated jail role", async () => {
    const f = jailAuthorityFixture();
    vi.mocked(f.target.roles.remove).mockImplementation(async () => {
      giveAuthority(f.rt, f.jailRole.id, "command");
      return f.target;
    });
    await expect(
      f.service.jail(f.ctx, f.target, f.record, "audit"),
    ).rejects.toThrow("mod.roleUnsafe");
    expect(f.target.roles.add).not.toHaveBeenCalled();
    expect(f.rt.db.get("g", "jail", f.target.id)).toMatchObject({
      state: "applying",
      removed: [{ id: f.safeRole.id, permissions: "0" }],
    });
  });
});
