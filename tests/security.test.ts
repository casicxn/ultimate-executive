import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  Events,
  PermissionFlagsBits,
  PermissionsBitField,
  type ClientEvents,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
} from "discord.js";
import { createRuntime } from "../src/core/runtime.js";
import { attachRouter, routeMessage } from "../src/core/router.js";
import type {
  CommandContext,
  ComponentInteraction,
  Runtime,
} from "../src/core/types.js";
import { panelModule } from "../src/modules/panel/index.js";
import { utilitiesModule } from "../src/modules/utilities/index.js";

const resources: Runtime[] = [];
function runtime(): Runtime {
  const r = createRuntime(":memory:", "bot-owner", "silent");
  resources.push(r);
  return r;
}
afterEach(async () => {
  for (const r of resources.splice(0)) {
    r.scheduler.stop();
    await r.scheduler.drain();
    await r.client.destroy();
    if (r.db.sqlite.open) r.db.close();
  }
});
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function roleFixture() {
  const r = runtime();
  const roles = new Collection<string, Role>();
  const channels = new Collection();
  const fetchMember =
    vi.fn<
      (input: string | { user: string; force: boolean }) => Promise<GuildMember>
    >();
  const fetchChannel = vi.fn();
  const fetchRole = vi.fn(async (id: string) => roles.get(id) ?? null);
  const guild = {
    id: "g",
    ownerId: "guild-owner",
    roles: { cache: roles, fetch: fetchRole },
    channels: { cache: channels, fetch: fetchChannel },
    members: { me: undefined, fetch: fetchMember, fetchMe: vi.fn() },
  } as unknown as Guild;
  const role = (id: string, position: number, bits = 0n): Role => {
    const result = {
      id,
      guild,
      position,
      name: id,
      managed: false,
      permissions: new PermissionsBitField(bits),
      comparePositionTo: (other: Role) => position - other.position,
    } as unknown as Role;
    roles.set(id, result);
    return result;
  };
  const botRole = role("bot-role", 100, PermissionFlagsBits.Administrator);
  const bot = {
    id: "bot",
    guild,
    roles: { highest: botRole },
    permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
  } as unknown as GuildMember;
  Object.defineProperty(guild.members, "me", {
    value: bot,
    configurable: true,
  });
  role("g", 0);
  const candidate = role("111111111111111111", 5);
  const member = (
    id: string,
    highest = role(`${id}-highest`, 2),
  ): GuildMember =>
    ({
      id,
      guild,
      user: { id, bot: false },
      roles: {
        highest,
        cache: new Collection([[highest.id, highest]]),
        add: vi.fn(),
        remove: vi.fn(),
      },
      permissions: new PermissionsBitField(),
    }) as unknown as GuildMember;
  r.client.guilds.cache.set(guild.id, guild);
  return {
    r,
    guild,
    roles,
    channels,
    candidate,
    role,
    member,
    fetchMember,
    fetchChannel,
    fetchRole,
  };
}
describe("public role privilege boundaries", () => {
  it("never distributes the private-ticket support role through public rewards", async () => {
    const f = roleFixture();
    f.r.settings.setModuleConfig("g", "tickets", {
      supportRole: f.candidate.id,
      transcript: false,
    });
    expect(f.r.permissions.roleHasAuthority(f.candidate)).toBe(true);
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(false);
    f.r.settings.setModuleConfig("g", "tickets", {
      supportRole: f.role("support", 4).id,
      transcript: false,
    });
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(false);
  });
  it("allows an ordinary cosmetic role and isolates grants in other guilds", async () => {
    const f = roleFixture();
    f.r.db.set("another", "grants", `role:${f.candidate.id}`, {
      commands: ["ban"],
      groups: [],
    });
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(true);
  });
  it.each([
    { commands: ["ban"], groups: [] },
    { commands: [], groups: ["support"] },
  ])(
    "rejects direct or grouped Executive command capabilities: %j",
    async (grant) => {
      const f = roleFixture();
      f.r.db.set("g", "permissionGroups", "support", ["warn"]);
      f.r.db.set("g", "grants", `role:${f.candidate.id}`, grant);
      expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(
        false,
      );
    },
  );
  it("rejects protected roles and native administrative role permissions", async () => {
    const f = roleFixture();
    f.r.settings.update("g", { protectedRoles: [f.candidate.id] });
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(false);
    f.r.settings.update("g", { protectedRoles: [] });
    const dangerous = f.role(
      "dangerous",
      5,
      PermissionFlagsBits.ManageChannels,
    );
    expect(await f.r.permissions.canAssignPublicRole(dangerous)).toBe(false);
  });
  it("rejects hidden management powers granted through channel overwrites", async () => {
    const f = roleFixture();
    f.channels.set("private", {
      permissionOverwrites: {
        cache: new Collection([
          [
            f.candidate.id,
            {
              allow: new PermissionsBitField(
                PermissionFlagsBits.ManageMessages,
              ),
            },
          ],
        ]),
      },
    });
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(false);
  });
  it.each(["native", "custom", "protected"])(
    "prevents public roles from overtaking %s staff hierarchy",
    async (kind) => {
      const f = roleFixture();
      const staff = f.role(
        "staff",
        4,
        kind === "native" ? PermissionFlagsBits.BanMembers : 0n,
      );
      if (kind === "custom")
        f.r.db.set("g", "grants", "role:staff", {
          commands: ["warn"],
          groups: [],
        });
      if (kind === "protected")
        f.r.settings.update("g", { protectedRoles: ["staff"] });
      expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(
        false,
      );
      expect(
        await f.r.permissions.canAssignPublicRole(
          f.role("lower-cosmetic", staff.position - 1),
        ),
      ).toBe(true);
    },
  );
  it("checks user-specific staff and delegated managers before allowing a higher public role", async () => {
    const f = roleFixture();
    const staff = f.member("person", f.role("person-role", 4));
    f.fetchMember.mockResolvedValue(staff);
    f.r.db.set("g", "grants", "user:person", {
      commands: ["warn"],
      groups: [],
    });
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(false);
    f.r.db.delete("g", "grants", "user:person");
    f.r.settings.update("g", { configAdmins: ["person"] });
    expect(await f.r.permissions.canAssignPublicRole(f.candidate)).toBe(false);
  });
  it("fails closed when a user-specific staff hierarchy lookup fails", async () => {
    const f = roleFixture();
    f.r.db.set("g", "grants", "user:staff", { commands: ["warn"], groups: [] });
    f.fetchMember.mockRejectedValue(new Error("REST unavailable"));
    await expect(
      f.r.permissions.canAssignPublicRole(f.candidate),
    ).rejects.toThrow("REST unavailable");
  });
  it("rechecks a previously published self-role menu after the role gains staff capabilities", async () => {
    const f = roleFixture();
    utilitiesModule.register(f.r);
    const owner = f.member("guild-owner");
    const reply = vi.fn();
    await f.r.registry.find("selfrole")!.execute({
      runtime: f.r,
      guild: f.guild,
      member: owner,
      user: { id: owner.id },
      args: [f.candidate.id],
      locale: "en",
      reply,
    } as unknown as CommandContext);
    const menu = f.r.db.list("g", "roleMenus")[0]!;
    f.r.db.set("g", "grants", `role:${f.candidate.id}`, {
      commands: ["ban"],
      groups: [],
    });
    const user = f.member("normal");
    f.fetchMember.mockResolvedValue(user);
    const deferReply = vi.fn();
    const click = {
      isButton: () => true,
      guild: f.guild,
      guildId: "g",
      customId: `role:${menu.key}:${f.candidate.id}`,
      user: { id: user.id },
      deferReply,
      editReply: vi.fn(),
    } as unknown as ComponentInteraction;
    await expect(
      f.r.interactions.get("role")!.handle(click, f.r),
    ).rejects.toThrow("error.permission");
    expect(deferReply).toHaveBeenCalledOnce();
    expect(user.roles.add).not.toHaveBeenCalled();
  });
});

describe("graceful shutdown barriers", () => {
  it("waits for an active scheduled handler and its database changes before allowing close", async () => {
    const r = runtime(),
      entered = barrier(),
      release = barrier();
    r.scheduler.register("blocked", async () => {
      entered.release();
      await release.promise;
      r.db.set("g", "proof", "completed", true);
    });
    r.scheduler.schedule("g", "social", "blocked", 0, {}, "job");
    const tick = r.scheduler.tick();
    await entered.promise;
    r.scheduler.stop();
    let drained = false;
    const drain = r.scheduler.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(r.db.sqlite.open).toBe(true);
    release.release();
    await Promise.all([tick, drain]);
    expect(r.db.get("g", "proof", "completed")).toBe(true);
    expect(r.db.get("g", "jobs", "job")).toBeUndefined();
    r.db.close();
    expect(drained).toBe(true);
  });
  it("drains an active gateway handler and stops accepting new event work before database close", async () => {
    const r = runtime(),
      entered = barrier(),
      release = barrier();
    let calls = 0;
    r.messageHooks.push({
      module: "utilities",
      handle: async () => {
        calls++;
        entered.release();
        await release.promise;
        r.db.set("g", "proof", "message-complete", true);
      },
    });
    const drainRouter = attachRouter(r);
    const message = {
      guild: { id: "g" },
      author: { id: "user", bot: false },
      content: "hello",
    } as unknown as ClientEvents[Events.MessageCreate][0];
    r.client.emit(Events.MessageCreate, message);
    await entered.promise;
    let drained = false;
    const drain = drainRouter().then(() => {
      drained = true;
    });
    r.client.emit(Events.MessageCreate, message);
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(calls).toBe(1);
    release.release();
    await drain;
    expect(r.db.get("g", "proof", "message-complete")).toBe(true);
    r.db.close();
  });
});

function panelInteraction(
  guild: Guild,
  overrides: Record<string, unknown> = {},
): ComponentInteraction {
  return {
    guild,
    guildId: guild.id,
    user: { id: guild.ownerId },
    customId: "panel:section",
    values: ["economy"],
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    deferUpdate: vi.fn(),
    deferReply: vi.fn(),
    showModal: vi.fn(),
    editReply: vi.fn(),
    ...overrides,
  } as unknown as ComponentInteraction;
}
describe("panel acknowledgement and authorization", () => {
  it("opens a modal immediately without fetching a member or deferring the modal trigger", async () => {
    const f = roleFixture();
    panelModule.register(f.r);
    f.fetchMember.mockImplementation(() => new Promise(() => {}));
    const showModal = vi.fn();
    const interaction = panelInteraction(f.guild, {
      customId: "panel:edit:economy",
      isButton: () => true,
      showModal,
    });
    await f.r.interactions.get("panel")!.handle(interaction, f.r);
    expect(showModal).toHaveBeenCalledOnce();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(f.fetchMember).not.toHaveBeenCalled();
  });
  it("acknowledges channel selection before awaiting a channel lookup and updates only that guild", async () => {
    const f = roleFixture();
    panelModule.register(f.r);
    const entered = barrier(),
      release = barrier();
    const order: string[] = [];
    f.fetchChannel.mockImplementation(async () => {
      order.push("fetch");
      entered.release();
      await release.promise;
      return { id: "logs", isTextBased: () => true };
    });
    const interaction = panelInteraction(f.guild, {
      customId: "panel:channel:logging",
      values: ["logs"],
      isChannelSelectMenu: () => true,
      deferUpdate: vi.fn(async () => {
        order.push("ack");
      }),
    });
    const handling = f.r.interactions.get("panel")!.handle(interaction, f.r);
    await entered.promise;
    expect(order).toEqual(["ack", "fetch"]);
    expect(f.r.settings.get("g").logChannel).toBeUndefined();
    release.release();
    await handling;
    expect(f.r.settings.get("g").logChannel).toBe("logs");
    expect(f.r.settings.get("other").logChannel).toBeUndefined();
    expect(interaction.editReply).toHaveBeenCalledOnce();
  });
  it("denies unauthorized panel changes before lookups, acknowledgements or mutations", async () => {
    const f = roleFixture();
    panelModule.register(f.r);
    const previous = f.r.settings.get("g");
    const interaction = panelInteraction(f.guild, {
      customId: "panel:channel:logging",
      values: ["logs"],
      user: { id: "outsider" },
      isChannelSelectMenu: () => true,
    });
    await expect(
      f.r.interactions.get("panel")!.handle(interaction, f.r),
    ).rejects.toThrow("error.permission");
    expect(f.r.settings.get("g")).toEqual(previous);
    expect(f.fetchChannel).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });
  it("prevents delegated managers from changing the delegated manager list", async () => {
    const f = roleFixture();
    panelModule.register(f.r);
    f.r.settings.update("g", { configAdmins: ["delegate"] });
    const interaction = panelInteraction(f.guild, {
      customId: "panel:admins",
      user: { id: "delegate" },
      values: ["outsider"],
      isUserSelectMenu: () => true,
    });
    await expect(
      f.r.interactions.get("panel")!.handle(interaction, f.r),
    ).rejects.toThrow("error.permission");
    expect(f.r.settings.get("g").configAdmins).toEqual(["delegate"]);
  });
});

describe("custom command and automatic response disabling", () => {
  it.each([
    {
      disabled: "autoresponse",
      content: "hello",
      namespace: "autoresponse",
      key: "hello",
    },
    {
      disabled: "custom",
      content: ".greet",
      namespace: "custom",
      key: "greet",
    },
  ])(
    "does not send a disabled $namespace response",
    async ({ disabled, content, namespace, key }) => {
      const r = runtime();
      utilitiesModule.register(r);
      r.settings.update("g", { disabledCommands: [disabled] });
      r.db.set("g", namespace, key, "response");
      const send = vi.fn();
      const message = {
        id: "message",
        guild: { id: "g" },
        member: { id: "user" },
        author: { id: "user", bot: false },
        content,
        channel: { id: "channel", isSendable: () => true, send },
      } as unknown as Message;
      await routeMessage(r, message);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("keeps automatic responses enabled when custom commands alone are disabled", async () => {
    const r = runtime();
    utilitiesModule.register(r);
    r.settings.update("g", { disabledCommands: ["custom"] });
    r.db.set("g", "autoresponse", "hello", "response");
    const send = vi.fn();
    await routeMessage(r, {
      guild: { id: "g" },
      author: { id: "user", bot: false },
      content: "hello",
      channel: { id: "channel", isSendable: () => true, send },
    } as unknown as Message);
    expect(send).toHaveBeenCalledWith({
      content: "response",
      allowedMentions: { parse: [] },
    });
  });
});
