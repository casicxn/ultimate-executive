import { PermissionFlagsBits } from "discord.js";
import type { Module, CommandContext, Command } from "../../core/types.js";
import { t } from "../../core/localization.js";
import { assert, duration, integer, userId, safeText } from "../../shared.js";
import {
  ModerationService,
  assertSafeRole,
  overwriteValue,
  type JailState,
  type LockState,
} from "./service.js";
import type { ModerationCase } from "./cases.js";
import "./translations.js";

export const moderationModule: Module = {
  name: "moderation",
  register(runtime) {
    const service = new ModerationService(runtime);
    const add = (
      name: string,
      description: string,
      usage: string,
      execute: Command["execute"],
      aliases: string[] = [],
      nativePermission?: bigint,
    ) =>
      runtime.registry.register({
        name,
        aliases,
        module: "moderation",
        description,
        usage,
        permission: name,
        nativePermission,
        cooldown: 3000,
        execute,
      });
    const reason = (ctx: CommandContext, start = 1) =>
      ctx.args.slice(start).join(" ") || t(ctx.locale, "mod.noReason");
    const done = async (ctx: CommandContext, record: ModerationCase) =>
      ctx.reply(t(ctx.locale, "mod.done", { id: record.id }));
    async function optionalTarget(
      ctx: CommandContext,
      id: string,
    ): Promise<void> {
      assert(
        id !== ctx.guild.ownerId &&
          id !== ctx.user.id &&
          id !== runtime.client.user?.id,
        "error.permission",
      );
      assert(
        !runtime.settings.get(ctx.guild.id).protectedUsers.includes(id),
        "error.permission",
      );
      try {
        const member = await ctx.guild.members.fetch(id);
        runtime.permissions.assertTarget(ctx.member, member);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== 10007
        )
          throw error;
      }
    }
    add(
      "ban",
      "mod.ban",
      ".ban @user [1d] [reason]",
      async (ctx) => {
        const id = userId(ctx.args[0]);
        await optionalTarget(ctx, id);
        const hasDuration = /^\d+[smhdw]$/.test(ctx.args[1] ?? "");
        const time = hasDuration ? duration(ctx.args[1]) : undefined;
        const record = await service.perform(
          ctx,
          "ban",
          id,
          reason(ctx, hasDuration ? 2 : 1),
          async (audit) => {
            await ctx.guild.members.ban(id, {
              reason: audit,
              deleteMessageSeconds: 0,
            });
          },
          time,
        );
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.BanMembers,
    );
    add(
      "unban",
      "mod.unban",
      ".unban userId [reason]",
      async (ctx) => {
        const id = userId(ctx.args[0]);
        await optionalTarget(ctx, id);
        const ban = await ctx.guild.bans.fetch(id);
        const record = await service.perform(
          ctx,
          "unban",
          id,
          reason(ctx),
          async (audit) => {
            await ctx.guild.members.unban(id, audit);
          },
        );
        const previous = /Executive case=(\d+)/.exec(ban.reason ?? "")?.[1];
        if (previous)
          service.cases.reverse(ctx.guild.id, previous, ctx.user.id, record.id);
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.BanMembers,
    );
    add(
      "kick",
      "mod.kick",
      ".kick @user [reason]",
      async (ctx) => {
        const target = await service.target(ctx, userId(ctx.args[0]));
        assert(target.kickable, "error.permission");
        const record = await service.perform(
          ctx,
          "kick",
          target.id,
          reason(ctx),
          async (audit) => {
            await target.kick(audit);
          },
        );
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.KickMembers,
    );
    add(
      "mute",
      "mod.mute",
      ".mute @user 1h [reason]",
      async (ctx) => {
        const target = await service.target(ctx, userId(ctx.args[0]));
        assert(target.moderatable, "error.permission");
        const time = duration(ctx.args[1], 28 * 86400000);
        const record = await service.perform(
          ctx,
          "mute",
          target.id,
          reason(ctx, 2),
          async (audit) => {
            await target.timeout(time, audit);
          },
          time,
        );
        await done(ctx, record);
      },
      ["timeout"],
      PermissionFlagsBits.ModerateMembers,
    );
    add(
      "unmute",
      "mod.unmute",
      ".unmute @user [reason]",
      async (ctx) => {
        const target = await service.target(ctx, userId(ctx.args[0]));
        assert(target.moderatable, "error.permission");
        const record = await service.perform(
          ctx,
          "unmute",
          target.id,
          reason(ctx),
          async (audit) => {
            await target.timeout(null, audit);
          },
        );
        const prior = service.cases
          .list(ctx.guild.id, target.id)
          .find(
            (c) =>
              c.action === "mute" && c.status === "succeeded" && !c.reversedAt,
          );
        if (prior)
          service.cases.reverse(ctx.guild.id, prior.id, ctx.user.id, record.id);
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.ModerateMembers,
    );
    add(
      "sil",
      "mod.sil",
      ".sil 1-100 [reason]",
      async (ctx) => {
        const amount = integer(ctx.args[0], 1, 100);
        const channel = await ctx.guild.channels.fetch(ctx.channel.id);
        assert(channel && "bulkDelete" in channel);
        let count = 0;
        const record = await service.perform(
          ctx,
          "sil",
          channel.id,
          reason(ctx),
          async () => {
            // discord.js filters messages older than two weeks, avoiding API error 50034.
            const deleted = await channel.bulkDelete(amount, true);
            count = deleted.size;
            return `${count}`;
          },
        );
        await ctx.reply(t(ctx.locale, "mod.deleted", { count, id: record.id }));
      },
      ["purge", "clear"],
      PermissionFlagsBits.ManageMessages,
    );
    add("warn", "mod.warn", ".warn @user reason", async (ctx) => {
      const target = await service.target(ctx, userId(ctx.args[0]));
      assert(ctx.args.length > 1);
      const record = await service.perform(
        ctx,
        "warn",
        target.id,
        reason(ctx),
        async () => {},
      );
      await done(ctx, record);
    });
    add(
      "warnings",
      "mod.warnings",
      ".warnings @user",
      async (ctx) => {
        const id = userId(ctx.args[0]);
        const warnings = service.cases
          .list(ctx.guild.id, id)
          .filter(
            (c) =>
              c.action === "warn" && c.status === "succeeded" && !c.reversedAt,
          )
          .slice(0, 20);
        await ctx.reply(
          warnings.length
            ? warnings
                .map((c) =>
                  t(ctx.locale, "mod.warning", {
                    id: c.id,
                    reason: c.reason,
                    moderator: c.moderator,
                  }),
                )
                .join("\n")
            : t(ctx.locale, "mod.empty"),
        );
      },
      ["uyarilar"],
    );
    add(
      "clearwarn",
      "mod.clearwarn",
      ".clearwarn caseId [reason]",
      async (ctx) => {
        const id = String(integer(ctx.args[0]));
        const warning = service.cases.get(ctx.guild.id, id);
        assert(
          warning &&
            warning.action === "warn" &&
            warning.status === "succeeded" &&
            !warning.reversedAt,
        );
        await optionalTarget(ctx, warning.target);
        const record = await service.perform(
          ctx,
          "clearwarn",
          warning.target,
          reason(ctx),
          async (_audit, record) => {
            service.cases.reverse(
              ctx.guild.id,
              warning.id,
              ctx.user.id,
              record.id,
            );
          },
        );
        await done(ctx, record);
      },
    );
    add("jail", "mod.jail", ".jail @user [1h] [reason]", async (ctx) => {
      const target = await service.target(ctx, userId(ctx.args[0]));
      const timed = /^\d+[smhdw]$/.test(ctx.args[1] ?? "");
      const time = timed ? duration(ctx.args[1]) : undefined;
      const record = await service.perform(
        ctx,
        "jail",
        target.id,
        reason(ctx, timed ? 2 : 1),
        (audit, record) => service.jail(ctx, target, record, audit),
        time,
      );
      await done(ctx, record);
    });
    add("unjail", "mod.unjail", ".unjail @user [reason]", async (ctx) => {
      const target = await service.target(ctx, userId(ctx.args[0]));
      assert(runtime.db.get(ctx.guild.id, "jail", target.id), "mod.notJailed");
      let counts = { restored: 0, skipped: 0 };
      const record = await service.perform(
        ctx,
        "unjail",
        target.id,
        reason(ctx),
        async (_audit, record) => {
          counts = await service.unjail(
            ctx.guild,
            target,
            ctx.user.id,
            record.id,
            ctx.member,
          );
        },
      );
      await ctx.reply(
        `${t(ctx.locale, "mod.done", { id: record.id })}\n${t(ctx.locale, "mod.restoration", { count: counts.restored, skipped: counts.skipped })}`,
      );
    });
    add(
      "lock",
      "mod.lock",
      ".lock [reason]",
      async (ctx) => {
        const channel = await ctx.guild.channels.fetch(ctx.channel.id);
        assert(channel && "permissionOverwrites" in channel);
        assert(
          !runtime.db.get(ctx.guild.id, "channelLocks", channel.id),
          "mod.locked",
        );
        const record = await service.perform(
          ctx,
          "lock",
          channel.id,
          ctx.args.join(" "),
          async (audit, record) => {
            const state: LockState = {
              caseId: record.id,
              send: overwriteValue(channel, ctx.guild.id),
              state: "applying",
            };
            runtime.db.set(ctx.guild.id, "channelLocks", channel.id, state);
            await channel.permissionOverwrites.edit(
              ctx.guild.id,
              { SendMessages: false },
              { reason: audit },
            );
            state.state = "active";
            runtime.db.set(ctx.guild.id, "channelLocks", channel.id, state);
          },
        );
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.ManageChannels,
    );
    add(
      "unlock",
      "mod.unlock",
      ".unlock [reason]",
      async (ctx) => {
        const channel = await ctx.guild.channels.fetch(ctx.channel.id);
        assert(channel && "permissionOverwrites" in channel);
        const state = runtime.db.get<LockState>(
          ctx.guild.id,
          "channelLocks",
          channel.id,
        );
        assert(state, "mod.notLocked");
        const record = await service.perform(
          ctx,
          "unlock",
          channel.id,
          ctx.args.join(" "),
          async (audit, record) => {
            // Restore only if the bit is still the one Executive set; preserve external edits.
            if (overwriteValue(channel, ctx.guild.id) === false)
              await channel.permissionOverwrites.edit(
                ctx.guild.id,
                { SendMessages: state.send },
                { reason: audit },
              );
            runtime.db.delete(ctx.guild.id, "channelLocks", channel.id);
            service.cases.reverse(
              ctx.guild.id,
              state.caseId,
              ctx.user.id,
              record.id,
            );
          },
        );
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.ManageChannels,
    );
    add(
      "slowmode",
      "mod.slowmode",
      ".slowmode 0-21600 [reason]",
      async (ctx) => {
        const seconds = integer(ctx.args[0], 0, 21600);
        const channel = await ctx.guild.channels.fetch(ctx.channel.id);
        assert(channel && "setRateLimitPerUser" in channel);
        const record = await service.perform(
          ctx,
          "slowmode",
          channel.id,
          reason(ctx),
          async (audit) => {
            await channel.setRateLimitPerUser(seconds, audit);
          },
        );
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.ManageChannels,
    );
    add(
      "nick",
      "mod.nick",
      ".nick @user new nickname | -",
      async (ctx) => {
        const target = await service.target(ctx, userId(ctx.args[0]));
        const nickname = ctx.args.slice(1).join(" ");
        assert(nickname.length > 0 && nickname.length <= 32);
        const record = await service.perform(
          ctx,
          "nick",
          target.id,
          nickname,
          async (audit) => {
            await target.setNickname(
              nickname === "-" ? null : safeText(nickname, 32),
              audit,
            );
          },
        );
        await done(ctx, record);
      },
      [],
      PermissionFlagsBits.ManageNicknames,
    );
    add(
      "renk",
      "mod.renk",
      ".renk @role #RRGGBB",
      async (ctx) => {
        const role = await ctx.guild.roles.fetch(userId(ctx.args[0]));
        assert(role);
        assertSafeRole(ctx.member, role);
        assert(/^#[\da-f]{6}$/i.test(ctx.args[1] ?? ""));
        const color = Number.parseInt(ctx.args[1]!.slice(1), 16);
        const record = await service.perform(
          ctx,
          "renk",
          role.id,
          ctx.args[1]!,
          async (audit) => {
            await role.setColor(color, audit);
          },
        );
        await done(ctx, record);
      },
      ["color"],
      PermissionFlagsBits.ManageRoles,
    );
    add(
      "cezalar",
      "mod.history",
      ".cezalar [@user]",
      async (ctx) => {
        const id = ctx.args[0] ? userId(ctx.args[0]) : undefined;
        const cases = service.cases.list(ctx.guild.id, id).slice(0, 20);
        await ctx.reply(
          cases.length
            ? `${t(ctx.locale, "mod.historyTitle")}\n${cases.map((c) => t(ctx.locale, "mod.case", { id: c.id, action: c.action, target: c.target, status: t(ctx.locale, `mod.status.${c.status}`) })).join("\n")}`
            : t(ctx.locale, "mod.empty"),
        );
      },
      ["sicil", "cases"],
    );
    add("modstats", "mod.stats", ".modstats [@staff]", async (ctx) => {
      const id = ctx.args[0] ? userId(ctx.args[0]) : undefined;
      const counts = new Map<string, number>();
      for (const record of service.cases
        .list(ctx.guild.id)
        .filter((c) => c.status === "succeeded" && (!id || c.moderator === id)))
        counts.set(record.moderator, (counts.get(record.moderator) ?? 0) + 1);
      await ctx.reply(
        counts.size
          ? [...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([moderator, count]) =>
                t(ctx.locale, "mod.statsLine", { moderator, count }),
              )
              .join("\n")
          : t(ctx.locale, "mod.empty"),
      );
    });
    runtime.registry.register({
      name: "jailsetup",
      module: "moderation",
      description: "mod.jailsetup",
      usage: ".jailsetup @role #channel [@removeRoles...]",
      permission: "config",
      execute: async (ctx) => {
        assert(
          runtime.permissions.canConfigure(ctx.member),
          "error.permission",
        );
        await service.setupJail(ctx, {
          role: userId(ctx.args[0]),
          channel: userId(ctx.args[1]),
          removeRoles: ctx.args.slice(2).map(userId),
        });
        await ctx.reply(t(ctx.locale, "mod.jailConfigured"));
      },
    });
    runtime.scheduler.register("moderation.unban", async (job) => {
      const payload = job.payload as { target: string; caseId: string };
      // A short duration can expire while Discord is still queuing the original request.
      // Retain the reversal job until that request settles; after a restart there is no in-flight request.
      if (service.isInFlight(job.guild, payload.caseId))
        throw new Error("Moderation request is still in flight");
      const guild = await runtime.client.guilds.fetch(job.guild);
      let ban;
      try {
        ban = await guild.bans.fetch(payload.target);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 10026
        )
          return;
        throw error;
      }
      // A later ban from another moderator must never be reversed by this job.
      if (!ban.reason?.startsWith(`Executive case=${payload.caseId} `)) return;
      const record = service.cases.get(job.guild, payload.caseId);
      if (record?.reversedAt) return;
      await guild.members.unban(
        payload.target,
        `Executive expiration case=${payload.caseId} moderator=${record?.moderator ?? runtime.client.user?.id}`,
      );
      service.cases.reverse(
        job.guild,
        payload.caseId,
        runtime.client.user?.id ?? "system",
        `expiration:${job.id}`,
      );
    });
    runtime.scheduler.register("moderation.unjail", async (job) => {
      const payload = job.payload as { target: string; caseId: string };
      if (service.isInFlight(job.guild, payload.caseId))
        throw new Error("Moderation request is still in flight");
      const state = runtime.db.get<JailState>(
        job.guild,
        "jail",
        payload.target,
      );
      if (!state || state.caseId !== payload.caseId) return;
      const guild = await runtime.client.guilds.fetch(job.guild);
      let member;
      try {
        member = await guild.members.fetch(payload.target);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 10007
        ) {
          runtime.db.delete(job.guild, "jail", payload.target);
          service.cases.reverse(
            job.guild,
            payload.caseId,
            runtime.client.user?.id ?? "system",
            `expiration:${job.id}`,
          );
          return;
        }
        throw error;
      }
      await service.unjail(
        guild,
        member,
        runtime.client.user?.id ?? "system",
        `expiration:${job.id}`,
      );
    });
  },
};
