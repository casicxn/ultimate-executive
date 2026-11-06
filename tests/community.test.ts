import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
  type Interaction,
} from "discord.js";
import { pino } from "pino";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import { Registry } from "../src/core/registry.js";
import { Permissions } from "../src/core/permissions.js";
import { Scheduler } from "../src/core/scheduler.js";
import { registerModules } from "../src/core/runtime.js";
import { routeInteraction, routeMessage } from "../src/core/router.js";
import type { CommandContext, Module, Runtime } from "../src/core/types.js";
import { utilitiesModule } from "../src/modules/utilities/index.js";
import {
  welcomeModule,
  type WelcomeConfig,
} from "../src/modules/welcome/index.js";
import { statisticsModule } from "../src/modules/statistics/index.js";
import { configurationModule } from "../src/modules/configuration/index.js";
import {
  cleanupGuild,
  scheduleRetention,
} from "../src/modules/utilities/retention.js";

const ROLE = "123456789012345678",
  OTHER_ROLE = "223456789012345678";
const resources: Runtime[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const r of resources.splice(0)) {
    r.scheduler.stop();
    if (r.db.sqlite.open) r.db.close();
  }
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function runtime(
  modules: Module[] = [
    utilitiesModule,
    welcomeModule,
    statisticsModule,
    configurationModule,
  ],
  path = ":memory:",
): Runtime {
  const db = new Store(path),
    settings = new Settings(db),
    logger = pino({ level: "silent" });
  const client = {
    guilds: { cache: new Collection<string, Guild>(), fetch: vi.fn() },
    channels: { fetch: vi.fn() },
    ws: { ping: 0 },
  } as unknown as Client;
  const r: Runtime = {
    db,
    settings,
    logger,
    client,
    registry: new Registry(),
    permissions: new Permissions(db, settings),
    scheduler: new Scheduler(db, settings, logger),
    ownerId: "bot-owner",
    startedAt: Date.now(),
    interactions: new Map(),
    messageHooks: [],
    voiceHooks: [],
    memberHooks: [],
  };
  resources.push(r);
  registerModules(r, modules);
  return r;
}
function server(r: Runtime, id = "guild") {
  const roles = new Collection<string, Role>(),
    members = new Collection<string, GuildMember>();
  const channel = {
    id: "channel",
    send: vi.fn().mockResolvedValue({ id: "sent" }),
    isSendable: () => true,
    isTextBased: () => true,
    messages: {
      delete: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn().mockResolvedValue(undefined),
    },
  };
  const manageRoles = vi.fn().mockReturnValue(true);
  const hierarchy = vi.fn((role: Role) => 100 - role.position);
  const guild = {
    id,
    ownerId: "owner",
    name: "Community",
    roles: {
      cache: roles,
      fetch: vi.fn(async (role: string) => roles.get(role) ?? null),
    },
    members: {
      me: {
        permissions: { has: manageRoles },
        roles: { highest: { position: 100, comparePositionTo: hierarchy } },
      },
      fetch: vi.fn(async (user: string | { user: string }) => {
        const result = members.get(typeof user === "string" ? user : user.user);
        if (!result) throw new Error("Unknown member");
        return result;
      }),
    },
    channels: {
      cache: new Collection([["channel", channel]]),
      fetch: vi.fn().mockResolvedValue(channel),
    },
    memberCount: 2,
  } as unknown as Guild;
  r.client.guilds.cache.set(id, guild);
  const makeRole = (
    roleId = ROLE,
    bitfield = 0n,
    position = 1,
    managed = false,
  ) => {
    const role = {
      id: roleId,
      name: "Community role",
      position,
      managed,
      permissions: { bitfield },
      guild,
      comparePositionTo: (other: Role) => position - other.position,
    } as Role;
    roles.set(roleId, role);
    return role;
  };
  const makeMember = (user = "member", bot = false) => {
    const member = {
      id: user,
      guild,
      user: { id: user, username: "Member", bot },
      roles: {
        highest: { position: 10 },
        cache: new Collection<string, Role>(),
        add: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      permissions: { has: vi.fn().mockReturnValue(false) },
    } as unknown as GuildMember;
    members.set(user, member);
    return member;
  };
  return {
    guild,
    roles,
    members,
    channel,
    makeRole,
    makeMember,
    manageRoles,
    hierarchy,
  };
}
function context(
  r: Runtime,
  guild: Guild,
  member: GuildMember,
  args: string[] = [],
): CommandContext {
  return {
    runtime: r,
    guild,
    member,
    user: member.user,
    channel: { id: "channel" },
    args,
    locale: "tr",
    requestId: `request-${Math.random()}`,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as CommandContext;
}
function message(
  guild: Guild,
  member: GuildMember,
  channel: unknown,
  content = "hello",
): Message {
  return {
    id: `message-${Math.random()}`,
    guild,
    member,
    author: member.user,
    channel,
    content,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Message;
}
function component(guild: Guild, user: GuildMember, customId: string) {
  const raw = {
    guildId: guild.id,
    guild,
    user: user.user,
    channelId: "channel",
    message: { id: "sent" },
    customId,
    values: [] as string[],
    deferred: false,
    replied: false,
    ephemeral: false,
    isRepliable: () => true,
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    reply: vi.fn().mockImplementation(async () => {
      raw.replied = true;
    }),
    deferReply: vi.fn().mockImplementation(async () => {
      raw.deferred = true;
      raw.ephemeral = true;
    }),
    deferUpdate: vi.fn().mockImplementation(async () => {
      raw.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  return raw;
}
async function command(
  r: Runtime,
  name: string,
  ctx: CommandContext,
): Promise<void> {
  r.db.delete(
    ctx.guild.id,
    "cooldowns",
    `${ctx.member.id}:${r.registry.find(name)?.name}`,
  );
  await r.registry.execute(name, ctx);
}

describe("self-role and welcome authorization", () => {
  it("denies self-role menu creation to ordinary users without native permissions", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    s.makeRole();
    await expect(
      command(r, "selfrole", context(r, s.guild, member, [ROLE])),
    ).rejects.toThrow("error.permission");
    expect(r.db.list(s.guild.id, "roleMenus")).toEqual([]);
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("rejects a role omitted from the stored menu and rejects cross-guild component reuse", async () => {
    const r = runtime(),
      a = server(r),
      b = server(r, "other-guild"),
      alice = a.makeMember("alice"),
      bob = b.makeMember("bob");
    a.makeRole();
    a.makeRole(OTHER_ROLE);
    b.makeRole();
    r.db.set(a.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    const forged = component(a.guild, alice, `role:menu:${OTHER_ROLE}`),
      foreign = component(b.guild, bob, `role:menu:${ROLE}`);
    await routeInteraction(r, forged as unknown as Interaction);
    await routeInteraction(r, foreign as unknown as Interaction);
    expect(alice.roles.add).not.toHaveBeenCalled();
    expect(bob.roles.add).not.toHaveBeenCalled();
    expect(forged.reply).toHaveBeenCalledOnce();
    expect(foreign.reply).toHaveBeenCalledOnce();
  });
  it("revalidates role permissions after menu creation and refuses newly dangerous roles", async () => {
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner"),
      member = s.makeMember();
    s.makeRole();
    await command(r, "selfrole", context(r, s.guild, owner, [ROLE]));
    const id = r.db.list(s.guild.id, "roleMenus")[0]!.key;
    s.makeRole(ROLE, PermissionFlagsBits.Administrator);
    const i = component(s.guild, member, `role:${id}:${ROLE}`);
    await routeInteraction(r, i as unknown as Interaction);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(i.deferReply).toHaveBeenCalledOnce();
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Bu işlem için yetkiniz yok." }),
    );
  });
  it("revalidates the bot hierarchy at click time and supports safe role removal", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    const role = s.makeRole();
    r.db.set(s.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    s.makeRole(ROLE, 0n, 101);
    await routeInteraction(
      r,
      component(s.guild, member, `role:menu:${ROLE}`) as unknown as Interaction,
    );
    expect(member.roles.add).not.toHaveBeenCalled();
    s.makeRole();
    member.roles.cache.set(ROLE, role);
    await routeInteraction(
      r,
      component(s.guild, member, `role:menu:${ROLE}`) as unknown as Interaction,
    );
    expect(member.roles.remove).toHaveBeenCalledExactlyOnceWith(ROLE);
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("revokes a public menu when its role receives custom Executive staff authorization", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    s.makeRole();
    r.db.set(s.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    r.db.set(s.guild.id, "grants", `role:${ROLE}`, {
      commands: ["ban"],
      groups: [],
    });
    await routeInteraction(
      r,
      component(s.guild, member, `role:menu:${ROLE}`) as unknown as Interaction,
    );
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("refuses a role with a dangerous channel-specific overwrite despite safe global permissions", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    s.makeRole();
    r.db.set(s.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    Object.assign(s.channel, {
      permissionOverwrites: {
        cache: new Collection([
          [ROLE, { allow: { bitfield: PermissionFlagsBits.ManageMessages } }],
        ]),
      },
    });
    await routeInteraction(
      r,
      component(s.guild, member, `role:menu:${ROLE}`) as unknown as Interaction,
    );
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("prevents public role assignment from lifting a member above native staff in the hierarchy", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    s.makeRole(ROLE, 0n, 20);
    s.makeRole(OTHER_ROLE, PermissionFlagsBits.ModerateMembers, 10);
    r.db.set(s.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    await routeInteraction(
      r,
      component(s.guild, member, `role:menu:${ROLE}`) as unknown as Interaction,
    );
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("blocks role interactions while utilities are disabled", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    s.makeRole();
    r.db.set(s.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    r.settings.update(s.guild.id, { disabledModules: ["utilities"] });
    const i = component(s.guild, member, `role:menu:${ROLE}`);
    await routeInteraction(r, i as unknown as Interaction);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: 64,
        content: "Bu modül veya komut devre dışı.",
      }),
    );
  });
  it("rejects forged select values before any role mutation and preserves unrelated roles", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    const role = s.makeRole(),
      unrelated = s.makeRole(OTHER_ROLE);
    member.roles.cache.set(OTHER_ROLE, unrelated);
    r.db.set(s.guild.id, "roleMenus", "menu", { roles: [ROLE] });
    const forged = component(s.guild, member, "roleselect:menu");
    Object.assign(forged, {
      values: [OTHER_ROLE],
      isButton: () => false,
      isStringSelectMenu: () => true,
    });
    await routeInteraction(r, forged as unknown as Interaction);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
    const valid = component(s.guild, member, "roleselect:menu");
    Object.assign(valid, {
      values: [ROLE],
      isButton: () => false,
      isStringSelectMenu: () => true,
    });
    await routeInteraction(r, valid as unknown as Interaction);
    expect(member.roles.add).toHaveBeenCalledExactlyOnceWith(ROLE);
    expect(member.roles.remove).not.toHaveBeenCalled();
    member.roles.cache.set(ROLE, role);
    const remove = component(s.guild, member, "roleselect:menu");
    Object.assign(remove, {
      values: [],
      isButton: () => false,
      isStringSelectMenu: () => true,
    });
    await routeInteraction(r, remove as unknown as Interaction);
    expect(member.roles.remove).toHaveBeenCalledExactlyOnceWith(ROLE);
    expect(member.roles.cache.has(OTHER_ROLE)).toBe(true);
  });
  it("reuses stored select menus after a real database and router restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "executive-utilities-"));
    directories.push(dir);
    const path = join(dir, "data.sqlite");
    const first = runtime([utilitiesModule], path),
      a = server(first),
      owner = a.makeMember("owner");
    a.makeRole();
    await command(
      first,
      "selfrole",
      context(first, a.guild, owner, ["select", ROLE]),
    );
    const id = first.db.list(a.guild.id, "roleMenus")[0]!.key;
    first.db.close();
    const second = runtime([utilitiesModule], path),
      b = server(second),
      member = b.makeMember();
    b.makeRole();
    const i = component(b.guild, member, `roleselect:${id}`);
    Object.assign(i, {
      values: [ROLE],
      isButton: () => false,
      isStringSelectMenu: () => true,
    });
    await routeInteraction(second, i as unknown as Interaction);
    expect(member.roles.add).toHaveBeenCalledExactlyOnceWith(ROLE);
    expect(i.deferReply).toHaveBeenCalledOnce();
  });
  it("allows a permission-free welcome role only when the bot can manage it", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    const role = s.makeRole();
    r.settings.setModuleConfig<WelcomeConfig>(s.guild.id, "welcome", {
      autoRole: ROLE,
    });
    await r.memberHooks.find((h) => h.module === "welcome")!.join!(member);
    expect(member.roles.add).toHaveBeenCalledExactlyOnceWith(
      role,
      "Executive welcome auto-role",
    );
    vi.mocked(member.roles.add).mockClear();
    s.manageRoles.mockReturnValue(false);
    await r.memberHooks.find((h) => h.module === "welcome")!.join!(member);
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("denies welcome roles that became privileged, managed, too high or the everyone role", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    r.settings.setModuleConfig<WelcomeConfig>(s.guild.id, "welcome", {
      autoRole: ROLE,
    });
    const hook = r.memberHooks.find((h) => h.module === "welcome")!;
    for (const [permissions, position, managed] of [
      [PermissionFlagsBits.ManageRoles, 1, false],
      [0n, 101, false],
      [0n, 1, true],
    ] as const) {
      s.makeRole(ROLE, permissions, position, managed);
      await hook.join!(member);
    }
    s.makeRole(s.guild.id);
    r.settings.setModuleConfig<WelcomeConfig>(s.guild.id, "welcome", {
      autoRole: s.guild.id,
    });
    await hook.join!(member);
    expect(member.roles.add).not.toHaveBeenCalled();
  });
  it("skips bot auto-roles and suppresses mentions in welcome templates and user names", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember("bot", true);
    s.makeRole();
    r.settings.setModuleConfig<WelcomeConfig>(s.guild.id, "welcome", {
      autoRole: ROLE,
      channel: "channel",
      joinTemplate: "Hello {user}",
    });
    Object.assign(member.user, { username: "@everyone" });
    await r.memberHooks.find((h) => h.module === "welcome")!.join!(member);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(s.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ allowedMentions: { parse: [] } }),
    );
    const payload = vi.mocked(s.channel.send).mock.calls[0]![0];
    expect(JSON.stringify(payload)).toContain("＠everyone");
  });
});

describe("safe custom commands and automation", () => {
  it("stores executable-looking text as plain text and neutralizes mass mentions before sending", async () => {
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner"),
      member = s.makeMember();
    expect(Reflect.has(globalThis, "executiveUnsafeExecution")).toBe(false);
    const body =
      "globalThis.executiveUnsafeExecution = true; @everyone <@&123456789012345678>";
    await command(
      r,
      "custom",
      context(r, s.guild, owner, ["set", "greet", ...body.split(" ")]),
    );
    await routeMessage(r, message(s.guild, member, s.channel, ".greet"));
    expect(Reflect.has(globalThis, "executiveUnsafeExecution")).toBe(false);
    expect(s.channel.send).toHaveBeenCalledExactlyOnceWith({
      content:
        "globalThis.executiveUnsafeExecution = true; ＠everyone <＠&123456789012345678>",
      allowedMentions: { parse: [] },
    });
  });
  it("prevents custom commands from overriding builtin names or aliases", async () => {
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner");
    await expect(
      command(
        r,
        "custom",
        context(r, s.guild, owner, ["set", "HELP", "Unsafe"]),
      ),
    ).rejects.toThrow();
    await expect(
      command(
        r,
        "custom",
        context(r, s.guild, owner, ["set", "YARDIM", "Unsafe"]),
      ),
    ).rejects.toThrow();
    expect(r.db.list(s.guild.id, "custom")).toEqual([]);
  });
  it("shares a persistent per-user/channel cooldown between custom and auto responses", async () => {
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner"),
      member = s.makeMember();
    await command(
      r,
      "custom",
      context(r, s.guild, owner, ["set", "greet", "Hello"]),
    );
    await command(
      r,
      "autoresponse",
      context(r, s.guild, owner, ["set", "hello", "Hi"]),
    );
    await routeMessage(r, message(s.guild, member, s.channel, ".greet"));
    await routeMessage(r, message(s.guild, member, s.channel, "hello"));
    expect(s.channel.send).toHaveBeenCalledTimes(1);
    expect(
      r.db.get(s.guild.id, "autoCooldown", `${member.id}:${s.channel.id}`),
    ).toBeGreaterThan(Date.now());
    const another = s.makeMember("another");
    await routeMessage(r, message(s.guild, another, s.channel, "hello"));
    expect(s.channel.send).toHaveBeenCalledTimes(2);
  });
  it("keeps custom and auto-response disabling independent", async () => {
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner"),
      member = s.makeMember();
    await command(
      r,
      "custom",
      context(r, s.guild, owner, ["set", "greet", "Hello"]),
    );
    await command(
      r,
      "autoresponse",
      context(r, s.guild, owner, ["set", "hello", "Hi"]),
    );
    await command(
      r,
      "config",
      context(r, s.guild, owner, ["command", "autoresponse", "off"]),
    );
    await routeMessage(r, message(s.guild, member, s.channel, "hello"));
    expect(s.channel.send).not.toHaveBeenCalled();
    await routeMessage(r, message(s.guild, member, s.channel, ".greet"));
    expect(s.channel.send).toHaveBeenCalledExactlyOnceWith({
      content: "Hello",
      allowedMentions: { parse: [] },
    });
    await command(
      r,
      "config",
      context(r, s.guild, owner, ["command", "autoresponse", "on"]),
    );
    await command(
      r,
      "config",
      context(r, s.guild, owner, ["command", "custom", "off"]),
    );
    const another = s.makeMember("another");
    await routeMessage(r, message(s.guild, another, s.channel, ".greet"));
    expect(s.channel.send).toHaveBeenCalledTimes(1);
    await routeMessage(r, message(s.guild, another, s.channel, "hello"));
    expect(s.channel.send).toHaveBeenCalledTimes(2);
  });
  it("retains custom command data but prevents hooks from running when the module is disabled", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    r.db.set(s.guild.id, "custom", "greet", "Hello");
    r.settings.update(s.guild.id, { disabledModules: ["utilities"] });
    await routeMessage(r, message(s.guild, member, s.channel, ".greet"));
    expect(s.channel.send).not.toHaveBeenCalled();
    expect(r.db.get(s.guild.id, "custom", "greet")).toBe("Hello");
    r.settings.update(s.guild.id, { disabledModules: [] });
    await routeMessage(r, message(s.guild, member, s.channel, ".greet"));
    expect(s.channel.send).toHaveBeenCalledOnce();
  });
  it("does not leak custom commands across guilds", async () => {
    const r = runtime(),
      a = server(r),
      b = server(r, "other-guild"),
      member = b.makeMember();
    r.db.set(a.guild.id, "custom", "greet", "Private server text");
    await routeMessage(r, message(b.guild, member, b.channel, ".greet"));
    expect(b.channel.send).not.toHaveBeenCalled();
  });
});

describe("configuration isolation and activity hooks", () => {
  it("switches the guild language through the Turkish alias and checks permission", async () => {
    const r = runtime();
    const primary = server(r, "primary");
    const secondary = server(r, "secondary");
    const owner = primary.makeMember("owner");
    const member = primary.makeMember("member");
    await expect(
      command(r, "language", context(r, primary.guild, member, ["en"])),
    ).rejects.toThrow("error.permission");
    const change = context(r, primary.guild, owner, ["en"]);
    await command(r, "dil", change);
    expect(change.reply).toHaveBeenCalledWith(
      "Server language set to English.",
    );
    expect(r.settings.get(primary.guild.id).locale).toBe("en");
    expect(r.settings.get(secondary.guild.id).locale).toBe("tr");
    await expect(
      command(r, "language", context(r, primary.guild, owner, ["fr"])),
    ).rejects.toThrow("error.input");
    expect(r.settings.get(primary.guild.id).locale).toBe("en");
  });
  it("normalizes aliases when disabling commands and cannot lock configuration recovery", async () => {
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner"),
      member = s.makeMember();
    await command(
      r,
      "config",
      context(r, s.guild, owner, ["command", "UPTIME", "off"]),
    );
    expect(r.settings.get(s.guild.id).disabledCommands).toEqual(["ping"]);
    await expect(
      command(r, "ping", context(r, s.guild, member)),
    ).rejects.toThrow("error.disabled");
    await expect(
      command(r, "uptime", context(r, s.guild, member)),
    ).rejects.toThrow("error.disabled");
    await expect(
      command(
        r,
        "config",
        context(r, s.guild, owner, ["command", "AYAR", "off"]),
      ),
    ).rejects.toThrow();
    await expect(
      command(
        r,
        "config",
        context(r, s.guild, owner, ["module", "configuration", "off"]),
      ),
    ).rejects.toThrow();
    expect(r.settings.get(s.guild.id).disabledCommands).not.toContain("config");
    expect(r.settings.get(s.guild.id).disabledModules).not.toContain(
      "configuration",
    );
  });
  it("restricts configuration to the owner or explicitly delegated administrators of this guild", async () => {
    const r = runtime(),
      a = server(r),
      b = server(r, "other-guild"),
      member = a.makeMember(),
      foreign = b.makeMember();
    vi.mocked(member.permissions.has).mockReturnValue(true);
    r.db.set(a.guild.id, "grants", `user:${member.id}`, {
      commands: ["config"],
      groups: [],
    });
    await expect(
      command(r, "config", context(r, a.guild, member, ["language", "en"])),
    ).rejects.toThrow("error.permission");
    r.settings.update(a.guild.id, { configAdmins: [member.id] });
    await command(r, "config", context(r, a.guild, member, ["language", "en"]));
    expect(r.settings.get(a.guild.id).locale).toBe("en");
    await expect(
      command(r, "config", context(r, b.guild, foreign, ["language", "en"])),
    ).rejects.toThrow("error.permission");
    expect(r.settings.get(b.guild.id).locale).toBe("tr");
  });
  it("counts human activity through routing while ignoring bot, webhook and disabled-module events", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember(),
      bot = s.makeMember("bot", true);
    await routeMessage(r, message(s.guild, member, s.channel));
    await routeMessage(r, message(s.guild, bot, s.channel));
    await routeMessage(r, {
      ...message(s.guild, member, s.channel),
      webhookId: "webhook",
    } as Message);
    expect(r.db.get(s.guild.id, "statistics", "activity")).toMatchObject({
      messages: 1,
      channels: { channel: 1 },
    });
    r.settings.update(s.guild.id, { disabledModules: ["statistics"] });
    await routeMessage(r, message(s.guild, member, s.channel));
    expect(r.db.get(s.guild.id, "statistics", "activity")).toMatchObject({
      messages: 1,
    });
    r.settings.update(s.guild.id, { disabledModules: [] });
    await routeMessage(r, message(s.guild, member, s.channel));
    expect(r.db.get(s.guild.id, "statistics", "activity")).toMatchObject({
      messages: 2,
    });
  });
});

describe("suggestion message lifecycle", () => {
  it("edits the original suggestion on approval and closes voting without creating a duplicate panel", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember(),
      owner = s.makeMember("owner");
    const ctx = {
      ...context(r, s.guild, member, ["A", "new", "game", "night"]),
      channel: s.channel,
      requestId: "suggestion-id",
    } as unknown as CommandContext;
    await command(r, "suggest", ctx);
    expect(s.channel.send).toHaveBeenCalledOnce();
    expect(ctx.reply).toHaveBeenCalledWith("İşlem kaydedildi.");
    expect(r.db.get(s.guild.id, "suggestions", "suggestion-id")).toMatchObject({
      channel: "channel",
      message: "sent",
      status: "pending",
    });
    const i = component(s.guild, member, "suggest:suggestion-id:yes");
    await routeInteraction(r, i as unknown as Interaction);
    expect(i.deferUpdate).toHaveBeenCalledOnce();
    expect(i.editReply).toHaveBeenCalledOnce();
    await command(
      r,
      "suggestion",
      context(r, s.guild, owner, ["approve", "suggestion-id"]),
    );
    expect(s.channel.send).toHaveBeenCalledOnce();
    expect(s.channel.messages.edit).toHaveBeenCalledWith(
      "sent",
      expect.objectContaining({ allowedMentions: { parse: [] } }),
    );
    const view = s.channel.messages.edit.mock.calls[0]![1];
    expect(
      JSON.parse(JSON.stringify(view)).components[0].components.every(
        (button: { disabled: boolean }) => button.disabled,
      ),
    ).toBe(true);
    const late = component(s.guild, member, "suggest:suggestion-id:no");
    await routeInteraction(r, late as unknown as Interaction);
    expect(late.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(r.db.get(s.guild.id, "suggestions", "suggestion-id")).toMatchObject({
      status: "approve",
      votes: { member: true },
    });
  });
  it("rejects forged choices, copied messages, and cross-guild suggestion voting", async () => {
    const r = runtime(),
      a = server(r),
      b = server(r, "other-guild"),
      member = a.makeMember(),
      foreign = b.makeMember();
    r.db.set(a.guild.id, "suggestions", "suggestion-id", {
      id: "suggestion-id",
      channel: "channel",
      message: "sent",
      body: "Idea",
      author: "author",
      votes: {},
      status: "pending",
    });
    const invalid = component(a.guild, member, "suggest:suggestion-id:maybe");
    const copied = component(a.guild, member, "suggest:suggestion-id:yes");
    copied.message.id = "copied";
    const cross = component(b.guild, foreign, "suggest:suggestion-id:yes");
    for (const i of [invalid, copied, cross]) {
      await routeInteraction(r, i as unknown as Interaction);
      expect(i.reply).toHaveBeenCalledOnce();
      expect(i.deferUpdate).not.toHaveBeenCalled();
    }
    expect(r.db.get(a.guild.id, "suggestions", "suggestion-id")).toMatchObject({
      votes: {},
    });
    expect(r.db.list(b.guild.id, "suggestions")).toEqual([]);
  });
  it("creates optional discussion threads once and retains the suggestion if thread permissions are denied", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    r.settings.setModuleConfig(s.guild.id, "utilities", {
      suggestionThreads: true,
    });
    const startThread = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Missing permissions"), { code: 50013 }),
      )
      .mockResolvedValueOnce({ id: "thread" });
    s.channel.send.mockResolvedValue({ id: "sent", startThread } as never);
    const first = {
      ...context(r, s.guild, member, ["Idea"]),
      channel: s.channel,
      requestId: "suggestion-a",
    } as unknown as CommandContext;
    await command(r, "suggest", first);
    expect(r.db.get(s.guild.id, "suggestions", "suggestion-a")).toMatchObject({
      message: "sent",
      status: "pending",
    });
    expect(first.reply).toHaveBeenCalledWith("İşlem kaydedildi.");
    const second = {
      ...context(r, s.guild, member, ["Second", "idea"]),
      channel: s.channel,
      requestId: "suggestion-b",
    } as unknown as CommandContext;
    await command(r, "suggest", second);
    expect(startThread).toHaveBeenCalledTimes(2);
    expect(startThread).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoArchiveDuration: 60 }),
    );
    expect(r.db.get(s.guild.id, "suggestions", "suggestion-b")).toMatchObject({
      thread: "thread",
    });
    await command(r, "suggest", second);
    expect(startThread).toHaveBeenCalledTimes(2);
    expect(s.channel.send).toHaveBeenCalledTimes(2);
  });
  it("preserves votes and staff decisions made while an optional discussion thread is being created", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember(),
      owner = s.makeMember("owner");
    r.settings.setModuleConfig(s.guild.id, "utilities", {
      suggestionThreads: true,
    });
    let finishThread!: (value: { id: string }) => void,
      threadStarted!: () => void;
    const waiting = new Promise<{ id: string }>((resolve) => {
        finishThread = resolve;
      }),
      started = new Promise<void>((resolve) => {
        threadStarted = resolve;
      });
    const startThread = vi.fn(() => {
      threadStarted();
      return waiting;
    });
    s.channel.send.mockResolvedValue({ id: "sent", startThread } as never);
    const ctx = {
      ...context(r, s.guild, member, ["Idea"]),
      channel: s.channel,
      requestId: "thread-race",
    } as unknown as CommandContext;
    const creating = command(r, "suggest", ctx);
    await started;
    await routeInteraction(
      r,
      component(
        s.guild,
        member,
        "suggest:thread-race:yes",
      ) as unknown as Interaction,
    );
    await command(
      r,
      "suggestion",
      context(r, s.guild, owner, ["approve", "thread-race"]),
    );
    finishThread({ id: "thread" });
    await creating;
    expect(r.db.get(s.guild.id, "suggestions", "thread-race")).toMatchObject({
      status: "approve",
      votes: { member: true },
      thread: "thread",
    });
  });
  it("pauses sticky automation without deleting configured text", async () => {
    const r = runtime(),
      s = server(r),
      member = s.makeMember();
    r.db.set(s.guild.id, "sticky", "channel", { text: "Sticky text", last: 0 });
    r.settings.update(s.guild.id, { disabledCommands: ["sticky"] });
    await routeMessage(r, message(s.guild, member, s.channel));
    expect(s.channel.send).not.toHaveBeenCalled();
    expect(r.db.get(s.guild.id, "sticky", "channel")).toMatchObject({
      text: "Sticky text",
    });
    r.settings.update(s.guild.id, { disabledCommands: [] });
    await routeMessage(r, message(s.guild, member, s.channel));
    expect(s.channel.send).toHaveBeenCalledExactlyOnceWith({
      content: "Sticky text",
      allowedMentions: { parse: [] },
    });
  });
});

describe("conservative guild retention", () => {
  const day = 86400000;
  function old(
    r: Runtime,
    namespace: string,
    key: string,
    value: unknown,
    guild = "guild",
  ) {
    r.db.set(guild, namespace, key, value);
    r.db.sqlite
      .prepare(
        "UPDATE records SET updated=? WHERE guild=? AND namespace=? AND key=?",
      )
      .run(Date.now() - 60 * day, guild, namespace, key);
  }
  it("deletes terminal old metadata while retaining active, uncertain and unfinished rewards", () => {
    const r = runtime();
    const terminals: { namespace: string; value: unknown }[] = [
      { namespace: "gameSessions", value: { status: "draw" } },
      { namespace: "proposals", value: { status: "expired" } },
      { namespace: "reminders", value: { status: "sent" } },
      { namespace: "giveaways", value: { status: "ended" } },
      { namespace: "polls", value: { status: "ended" } },
      { namespace: "events", value: { status: "cancelled" } },
      { namespace: "tickets", value: { state: "closed" } },
      { namespace: "suggestions", value: { status: "reject" } },
    ];
    for (const row of terminals) old(r, row.namespace, "terminal", row.value);
    for (const [ns, value] of [
      ["gameSessions", { status: "active" }],
      ["proposals", { status: "pending" }],
      ["reminders", { status: "sending" }],
      ["giveaways", { status: "active" }],
      ["polls", { status: "active" }],
      ["events", { status: "scheduled" }],
      ["tickets", { state: "uncertain" }],
      ["suggestions", { status: "pending" }],
    ] as const)
      old(r, ns, "active", value);
    old(r, "gameSessions", "unpaid", {
      status: "won",
      winner: "human",
      rewarded: false,
    });
    old(r, "reminders", "uncertain", { status: "uncertain" });
    r.db.set("guild", "suggestions", "recent", { status: "approve" });
    expect(cleanupGuild(r, "guild", 30)).toBe(8);
    for (const row of terminals) {
      expect(r.db.get("guild", row.namespace, "terminal")).toBeUndefined();
      expect(r.db.get("guild", row.namespace, "active")).toBeDefined();
    }
    expect(r.db.get("guild", "gameSessions", "unpaid")).toBeDefined();
    expect(r.db.get("guild", "reminders", "uncertain")).toBeDefined();
    expect(r.db.get("guild", "suggestions", "recent")).toBeDefined();
  });
  it("preserves pending job dependencies and never touches balances, permissions, cases or replay ledgers", () => {
    const r = runtime();
    old(r, "giveaways", "awaiting-edit", { status: "ended" });
    r.scheduler.schedule(
      "guild",
      "giveaways",
      "giveaway.end",
      1,
      { id: "awaiting-edit" },
      "job",
    );
    for (const ns of [
      "wallets",
      "grants",
      "permissionGroups",
      "cases",
      "moderationCases",
      "economyLedger",
      "xpLedger",
      "repLedger",
      "communityOperations",
    ])
      old(r, ns, "protected", {
        balance: 100,
        commands: ["ban"],
        status: "completed",
      });
    old(r, "cooldowns", "expired", 1);
    old(r, "autoCooldown", "expired", 1);
    old(r, "afkNotices", "expired", 1);
    old(r, "actionLimits", "expired", { start: 1, count: 10 });
    old(r, "cooldowns", "future", Date.now() + day);
    old(r, "suggestions", "foreign", { status: "approve" }, "other-guild");
    expect(cleanupGuild(r, "guild", 30)).toBe(4);
    expect(r.db.get("guild", "giveaways", "awaiting-edit")).toBeDefined();
    expect(r.db.get("guild", "cooldowns", "future")).toBeDefined();
    for (const ns of [
      "wallets",
      "grants",
      "permissionGroups",
      "cases",
      "moderationCases",
      "economyLedger",
      "xpLedger",
      "repLedger",
      "communityOperations",
    ])
      expect(r.db.get("guild", ns, "protected")).toBeDefined();
    expect(r.db.get("other-guild", "suggestions", "foreign")).toBeDefined();
    expect(r.db.get("guild", "jobs", "job")).toBeDefined();
  });
  it("cleans terminal ticket indexes only when they still refer to the removed ticket", () => {
    const r = runtime();
    old(r, "tickets", "closed", {
      state: "closed",
      channel: "old-channel",
      owner: "user",
    });
    r.db.set("guild", "ticketChannels", "old-channel", "closed");
    r.db.set("guild", "ticketActive", "user", "new-ticket");
    expect(cleanupGuild(r, "guild", 30)).toBe(2);
    expect(r.db.get("guild", "ticketChannels", "old-channel")).toBeUndefined();
    expect(r.db.get("guild", "ticketActive", "user")).toBe("new-ticket");
  });
  it("schedules one daily cleanup, pauses it with the module and keeps one successor after execution", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const r = runtime(),
      s = server(r),
      owner = s.makeMember("owner");
    await command(r, "cleanup", context(r, s.guild, owner, ["30"]));
    scheduleRetention(r, s.guild.id);
    expect(r.db.list(s.guild.id, "jobs")).toHaveLength(1);
    const first = r.db.list<{ due: number }>(s.guild.id, "jobs")[0]!;
    now = first.value.due;
    r.settings.update(s.guild.id, { disabledModules: ["utilities"] });
    await r.scheduler.tick(now);
    expect(r.db.list(s.guild.id, "jobs")).toHaveLength(1);
    expect(r.db.get(s.guild.id, "jobs", first.key)).toBeDefined();
    r.settings.update(s.guild.id, { disabledModules: [] });
    await r.scheduler.tick(now);
    const jobs = r.db.list<{ due: number; type: string }>(s.guild.id, "jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.key).not.toBe(first.key);
    expect(jobs[0]!.value).toMatchObject({
      due: now + day,
      type: "utilities.retention",
    });
  });
  it("restores daily retention from durable settings and jobs after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "executive-retention-"));
    directories.push(dir);
    const path = join(dir, "data.sqlite");
    const a = runtime([utilitiesModule], path);
    a.settings.setModuleConfig("guild", "retention", { days: 90 });
    scheduleRetention(a, "guild");
    const first = a.db.list("guild", "jobs")[0]!.key;
    a.db.close();
    const b = runtime([utilitiesModule], path);
    expect(b.db.list("guild", "jobs")).toHaveLength(1);
    expect(b.db.get("guild", "jobs", first)).toBeDefined();
    expect(b.scheduler.handlers.has("utilities.retention")).toBe(true);
    expect(() => cleanupGuild(b, "guild", 0)).toThrow();
    expect(() => cleanupGuild(b, "guild", 29)).toThrow();
    expect(() => cleanupGuild(b, "guild", 4000)).toThrow();
  });
});
