import {
  PermissionFlagsBits,
  type GuildMember,
  type Role,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
import type { Runtime, CommandContext } from "../../core/types.js";
import { t } from "../../core/localization.js";
import { assert, UserError, safeText } from "../../shared.js";
import { CaseRepository, type ModerationCase } from "./cases.js";

export const dangerousPermissions =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.ManageEvents |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ManageGuildExpressions |
  PermissionFlagsBits.ViewAuditLog;
export interface JailConfig {
  role: string;
  channel: string;
  removeRoles: string[];
}
export interface JailState {
  caseId: string;
  target: string;
  role: string;
  removed: { id: string; permissions: string }[];
  expires?: number;
  state: "applying" | "active" | "releasing";
}
export interface LockState {
  caseId: string;
  send: boolean | null;
  state: "applying" | "active" | "releasing";
}

export function assertSafeRole(actor: GuildMember, role: Role): void {
  const bot = actor.guild.members.me;
  assert(
    !role.managed &&
      role.id !== actor.guild.id &&
      bot &&
      role.comparePositionTo(bot.roles.highest) < 0,
    "mod.roleUnsafe",
  );
  assert(
    actor.id === actor.guild.ownerId ||
      role.comparePositionTo(actor.roles.highest) < 0,
    "mod.roleUnsafe",
  );
  assert(
    (role.permissions.bitfield & dangerousPermissions) === 0n,
    "mod.roleUnsafe",
  );
}
export class ModerationService {
  readonly cases: CaseRepository;
  private readonly inFlight = new Set<string>();
  constructor(readonly runtime: Runtime) {
    this.cases = new CaseRepository(runtime.db);
  }
  isInFlight(guild: string, caseId: string): boolean {
    return this.inFlight.has(`${guild}:${caseId}`);
  }
  async perform(
    ctx: CommandContext,
    action: string,
    target: string,
    reason: string,
    execute: (audit: string, record: ModerationCase) => Promise<string | void>,
    milliseconds?: number,
  ): Promise<ModerationCase> {
    this.runtime.permissions.consumeLimit(
      ctx.guild.id,
      ctx.member.id,
      action,
      this.runtime.settings.moduleConfig(ctx.guild.id, "moderation", {
        actionsPerMinute: 10,
      }).actionsPerMinute,
    );
    const record = this.runtime.db.transaction(() => {
      const pending = this.cases.begin({
        guild: ctx.guild.id,
        moderator: ctx.user.id,
        target,
        action,
        reason: safeText(reason || t(ctx.locale, "mod.noReason"), 350),
        requestId: ctx.requestId,
        duration: milliseconds,
        expires: milliseconds ? Date.now() + milliseconds : undefined,
      });
      // Commit reversal intent with the case before a Discord request can take effect.
      // The expiry handler verifies the actual ban audit reason, including for uncertain results.
      if (action === "ban" && pending.expires)
        this.runtime.scheduler.schedule(
          ctx.guild.id,
          "moderation",
          "moderation.unban",
          pending.expires,
          { target, caseId: pending.id },
          `ban:${target}:${pending.id}`,
        );
      return pending;
    });
    let result: string | void;
    this.inFlight.add(`${record.guild}:${record.id}`);
    try {
      result = await execute(this.cases.auditReason(record), record);
    } catch (error) {
      // A lost response may mean Discord applied the action. Never automatically replay it.
      const status = isDefinitiveFailure(error) ? "failed" : "uncertain";
      this.cases.finish(
        record,
        status,
        error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
      );
      this.runtime.logger.warn(
        { err: error, guild: record.guild, caseId: record.id, status },
        "Moderation action did not complete",
      );
      if (status === "uncertain")
        throw new UserError("mod.uncertain", { id: record.id });
      throw error;
    } finally {
      this.inFlight.delete(`${record.guild}:${record.id}`);
    }
    const finished = this.cases.finish(
      record,
      "succeeded",
      result || undefined,
    );
    this.runtime.logger.info(
      {
        guild: record.guild,
        caseId: record.id,
        moderator: record.moderator,
        target,
        action,
      },
      "Moderation action completed",
    );
    await this.log(finished);
    return finished;
  }
  async log(record: ModerationCase): Promise<void> {
    const settings = this.runtime.settings.get(record.guild);
    if (!settings.logChannel) return;
    try {
      const channel = await this.runtime.client.channels.fetch(
        settings.logChannel,
      );
      if (channel?.isSendable())
        await channel.send({
          content: t(settings.locale, "mod.case", {
            id: record.id,
            action: record.action,
            target: record.target,
            status: t(settings.locale, `mod.status.${record.status}`),
          }),
          allowedMentions: { parse: [] },
        });
    } catch (error) {
      this.runtime.logger.warn(
        { err: error, caseId: record.id },
        "Moderation log delivery failed",
      );
    }
  }
  async target(ctx: CommandContext, id: string): Promise<GuildMember> {
    const member = await ctx.guild.members.fetch(id);
    this.runtime.permissions.assertTarget(ctx.member, member);
    return member;
  }
  async setupJail(ctx: CommandContext, config: JailConfig): Promise<void> {
    const role = await ctx.guild.roles.fetch(config.role);
    assert(role);
    assertSafeRole(ctx.member, role);
    assert(!this.runtime.permissions.roleHasAuthority(role), "mod.roleUnsafe");
    const jailChannel = await ctx.guild.channels.fetch(config.channel);
    assert(
      jailChannel &&
        "permissionOverwrites" in jailChannel &&
        jailChannel.isTextBased(),
    );
    for (const id of config.removeRoles) {
      const removed = await ctx.guild.roles.fetch(id);
      assert(removed);
      assertSafeRole(ctx.member, removed);
      assert(
        !this.runtime.permissions.roleHasAuthority(removed),
        "mod.roleUnsafe",
      );
      assert(id !== config.role);
    }
    const channels = await ctx.guild.channels.fetch();
    for (const channel of channels.values())
      if (channel && "permissionOverwrites" in channel) {
        await channel.permissionOverwrites.edit(
          role,
          {
            ViewChannel: channel.id === config.channel,
            SendMessages: channel.id === config.channel,
            Connect: false,
          },
          { reason: `Executive jail setup moderator=${ctx.user.id}` },
        );
      }
    this.runtime.settings.setModuleConfig(ctx.guild.id, "jail", config);
  }
  async jail(
    ctx: CommandContext,
    target: GuildMember,
    record: ModerationCase,
    audit: string,
  ): Promise<void> {
    const { db, settings } = this.runtime;
    const config = settings.moduleConfig<JailConfig | undefined>(
      ctx.guild.id,
      "jail",
      undefined,
    );
    assert(config, "mod.jailConfig");
    assert(!db.get(ctx.guild.id, "jail", target.id), "mod.jailActive");
    const role = await ctx.guild.roles.fetch(config.role);
    assert(role);
    assertSafeRole(ctx.member, role);
    assert(!this.runtime.permissions.roleHasAuthority(role), "mod.roleUnsafe");
    const removed: Role[] = [];
    for (const id of config.removeRoles) {
      const candidate = target.roles.cache.get(id);
      if (candidate) {
        assertSafeRole(ctx.member, candidate);
        assert(
          !this.runtime.permissions.roleHasAuthority(candidate),
          "mod.roleUnsafe",
        );
        removed.push(candidate);
      }
    }
    const channels = await ctx.guild.channels.fetch();
    for (const channel of channels.values())
      if (
        channel &&
        "permissionOverwrites" in channel &&
        channel.id !== config.channel
      ) {
        // Reject newly created channels without the jail deny, member-specific allows, and retained role allows.
        assert(
          channel.permissionOverwrites.cache
            .get(role.id)
            ?.deny.has(PermissionFlagsBits.ViewChannel),
          "mod.jailConflict",
        );
        assert(
          !channel.permissionOverwrites.cache
            .get(target.id)
            ?.allow.has(PermissionFlagsBits.ViewChannel),
          "mod.jailConflict",
        );
        assert(
          !channel.permissionOverwrites.cache.some(
            (o) =>
              o.id !== ctx.guild.id &&
              target.roles.cache.has(o.id) &&
              !config.removeRoles.includes(o.id) &&
              o.allow.has(PermissionFlagsBits.ViewChannel),
          ),
          "mod.jailConflict",
        );
      }
    assert(
      !target.permissions.has(PermissionFlagsBits.Administrator),
      "mod.jailConflict",
    );
    const state: JailState = {
      caseId: record.id,
      target: target.id,
      role: role.id,
      removed: removed.map((r) => ({
        id: r.id,
        permissions: r.permissions.bitfield.toString(),
      })),
      expires: record.expires,
      state: "applying",
    };
    db.transaction(() => {
      // Recheck after asynchronous validation so two moderators cannot both jail the same member.
      assert(!db.get(ctx.guild.id, "jail", target.id), "mod.jailActive");
      db.set(ctx.guild.id, "jail", target.id, state);
      if (record.expires)
        this.runtime.scheduler.schedule(
          ctx.guild.id,
          "moderation",
          "moderation.unjail",
          record.expires,
          { target: target.id, caseId: record.id },
          `jail:${target.id}:${record.id}`,
        );
    });
    // Only the explicitly configured roles are changed; never replace the full role set.
    if (removed.length) await target.roles.remove(removed, audit);
    // The role may gain Executive authority while the previous Discord request is queued.
    assertSafeRole(ctx.member, role);
    assert(!this.runtime.permissions.roleHasAuthority(role), "mod.roleUnsafe");
    await target.roles.add(role, audit);
    state.state = "active";
    db.set(ctx.guild.id, "jail", target.id, state);
  }
  async unjail(
    guild: Guild,
    target: GuildMember,
    moderator: string,
    reversalCase: string,
    actor?: GuildMember,
  ): Promise<{ restored: number; skipped: number }> {
    const state = this.runtime.db.get<JailState>(guild.id, "jail", target.id);
    assert(state, "mod.notJailed");
    state.state = "releasing";
    this.runtime.db.set(guild.id, "jail", target.id, state);
    const audit = `Executive case=${reversalCase} moderator=${moderator} | jail reversal of case=${state.caseId}`;
    if (target.roles.cache.has(state.role))
      await target.roles.remove(state.role, audit);
    let restored = 0,
      skipped = 0;
    for (const original of state.removed) {
      const role = await guild.roles.fetch(original.id);
      if (
        !role ||
        role.managed ||
        !guild.members.me ||
        role.comparePositionTo(guild.members.me.roles.highest) >= 0 ||
        (actor &&
          actor.id !== guild.ownerId &&
          role.comparePositionTo(actor.roles.highest) >= 0) ||
        role.permissions.bitfield.toString() !== original.permissions ||
        (role.permissions.bitfield & dangerousPermissions) !== 0n ||
        this.runtime.permissions.roleHasAuthority(role)
      ) {
        skipped++;
        continue;
      }
      if (!target.roles.cache.has(role.id)) await target.roles.add(role, audit);
      restored++;
    }
    this.runtime.db.delete(guild.id, "jail", target.id);
    this.runtime.scheduler.cancel(
      guild.id,
      `jail:${target.id}:${state.caseId}`,
    );
    this.cases.reverse(guild.id, state.caseId, moderator, reversalCase);
    return { restored, skipped };
  }
}
export function isDefinitiveFailure(error: unknown): boolean {
  if (error instanceof UserError) return true;
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  )
    return error.status >= 400 && error.status < 500 && error.status !== 429;
  return false;
}
export function overwriteValue(
  channel: GuildBasedChannel,
  guild: string,
): boolean | null {
  assert("permissionOverwrites" in channel);
  const overwrite = channel.permissionOverwrites.cache.get(guild);
  return overwrite?.allow.has(PermissionFlagsBits.SendMessages)
    ? true
    : overwrite?.deny.has(PermissionFlagsBits.SendMessages)
      ? false
      : null;
}
