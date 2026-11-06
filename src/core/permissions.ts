import { PermissionFlagsBits, type GuildMember, type Role } from "discord.js";
import type { Store } from "../database/store.js";
import type { Settings } from "./settings.js";
import { assert } from "../shared.js";
const cosmeticPermissions =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.UseExternalStickers |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.Stream |
  PermissionFlagsBits.UseVAD |
  PermissionFlagsBits.ChangeNickname |
  PermissionFlagsBits.UseApplicationCommands |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.UseSoundboard |
  PermissionFlagsBits.UseExternalSounds |
  PermissionFlagsBits.SendVoiceMessages |
  PermissionFlagsBits.SendPolls |
  PermissionFlagsBits.UseEmbeddedActivities;
export interface Grants {
  commands: string[];
  groups: string[];
}
export class Permissions {
  constructor(
    readonly db: Store,
    readonly settings: Settings,
  ) {}
  canConfigure(member: GuildMember): boolean {
    return (
      member.id === member.guild.ownerId ||
      this.settings.get(member.guild.id).configAdmins.includes(member.id)
    );
  }
  can(
    member: GuildMember,
    command: string,
    nativePermission?: bigint,
  ): boolean {
    if (this.canConfigure(member)) return true;
    if (command === "config") return false;
    if (nativePermission && member.permissions.has(nativePermission))
      return true;
    const keys = [
      `user:${member.id}`,
      ...member.roles.cache.map((r) => `role:${r.id}`),
    ];
    return keys.some((key) => {
      const g = this.db.get<Grants>(member.guild.id, "grants", key);
      return (
        g &&
        (g.commands.includes(command) ||
          g.groups.some((group) =>
            this.db
              .get<string[]>(member.guild.id, "permissionGroups", group)
              ?.includes(command),
          ))
      );
    });
  }
  roleHasAuthority(role: Role): boolean {
    const guild = role.guild.id;
    const grant = this.db.get<Grants>(guild, "grants", `role:${role.id}`);
    const native = (role.permissions.bitfield & ~cosmeticPermissions) !== 0n;
    const channel =
      role.guild.channels?.cache.some(
        (channel) =>
          "permissionOverwrites" in channel &&
          Boolean(
            channel.permissionOverwrites.cache.get(role.id) &&
            (channel.permissionOverwrites.cache.get(role.id)!.allow.bitfield &
              ~cosmeticPermissions) !==
              0n,
          ),
      ) ?? false;
    return (
      native ||
      channel ||
      this.settings.get(guild).protectedRoles.includes(role.id) ||
      Boolean(
        grant && (grant.commands.length > 0 || grant.groups.length > 0),
      ) ||
      this.settings.moduleConfig<{ supportRole?: string }>(guild, "tickets", {})
        .supportRole === role.id
    );
  }
  async canAssignPublicRole(role: Role): Promise<boolean> {
    const guild = role.guild,
      settings = this.settings.get(guild.id);
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const safe = cosmeticPermissions;
    if (
      role.managed ||
      role.id === guild.id ||
      role.comparePositionTo(bot.roles.highest) >= 0 ||
      (role.permissions.bitfield & ~safe) !== 0n ||
      this.roleHasAuthority(role)
    )
      return false;
    if (
      guild.channels.cache.some(
        (channel) =>
          "permissionOverwrites" in channel &&
          channel.permissionOverwrites.cache.get(role.id) &&
          (channel.permissionOverwrites.cache.get(role.id)!.allow.bitfield &
            ~safe) !==
            0n,
      )
    )
      return false;
    const grants = this.db
      .list<Grants>(guild.id, "grants")
      .filter((g) => g.value.commands.length > 0 || g.value.groups.length > 0);
    const staffRoles = new Set([
      ...settings.protectedRoles,
      ...grants
        .filter((g) => g.key.startsWith("role:"))
        .map((g) => g.key.slice(5)),
    ]);
    const supportRole = this.settings.moduleConfig<{ supportRole?: string }>(
      guild.id,
      "tickets",
      {},
    ).supportRole;
    if (supportRole) staffRoles.add(supportRole);
    if (staffRoles.has(role.id)) return false;
    // Publicly obtainable roles must not raise staff hierarchy above protected/native/custom staff roles.
    for (const staffRole of guild.roles.cache.values())
      if (
        staffRole.id !== guild.id &&
        (staffRoles.has(staffRole.id) ||
          (staffRole.permissions.bitfield & ~safe) !== 0n) &&
        role.comparePositionTo(staffRole) >= 0
      )
        return false;
    const users = new Set([
      ...settings.configAdmins,
      ...grants
        .filter((g) => g.key.startsWith("user:"))
        .map((g) => g.key.slice(5)),
    ]);
    for (const id of users)
      if (id !== guild.ownerId) {
        let member: GuildMember;
        try {
          member = await guild.members.fetch({ user: id, force: false });
        } catch (error) {
          if ((error as { code?: number }).code === 10007) continue;
          throw error;
        }
        if (role.comparePositionTo(member.roles.highest) >= 0) return false;
      }
    return true;
  }
  assertTarget(actor: GuildMember, target: GuildMember): void {
    const settings = this.settings.get(actor.guild.id);
    assert(
      actor.id !== target.id && target.id !== actor.client.user?.id,
      "error.permission",
    );
    assert(target.id !== actor.guild.ownerId, "error.permission");
    assert(
      !settings.protectedUsers.includes(target.id) &&
        !target.roles.cache.some((r) => settings.protectedRoles.includes(r.id)),
      "error.permission",
    );
    assert(
      actor.id === actor.guild.ownerId ||
        actor.roles.highest.comparePositionTo(target.roles.highest) > 0,
      "error.permission",
    );
    const bot = actor.guild.members.me;
    assert(
      bot && bot.roles.highest.comparePositionTo(target.roles.highest) > 0,
      "error.permission",
    );
    assert(
      !target.permissions.has(PermissionFlagsBits.Administrator) ||
        actor.id === actor.guild.ownerId,
      "error.permission",
    );
  }
  consumeLimit(
    guild: string,
    actor: string,
    command: string,
    limit = 10,
    now = Date.now(),
  ): void {
    this.db.transaction(() => {
      const key = `${actor}:${command}`;
      const record = this.db.get<{ start: number; count: number }>(
        guild,
        "actionLimits",
        key,
      );
      const value =
        record && now - record.start < 60000
          ? record
          : { start: now, count: 0 };
      assert(value.count < limit, "error.cooldown", { seconds: 60 });
      value.count++;
      this.db.set(guild, "actionLimits", key, value);
    });
  }
}
