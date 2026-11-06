import { createHash } from "node:crypto";
import {
  AttachmentBuilder,
  EmbedBuilder,
  type GuildMember,
  type VoiceState,
} from "discord.js";
import type { Command, Module, Runtime } from "../../core/types.js";
import {
  registerTranslations,
  t,
  type Locale,
} from "../../core/localization.js";
import { assert, integer, userId } from "../../shared.js";
import { safeRewardRole } from "../economy/service.js";
import {
  LevelingService,
  levelingConfigSchema,
  levelFor,
  levelProgress,
} from "./service.js";
import { renderRankCard } from "./rank-card.js";

registerTranslations({
  "leveling.desc.level": {
    tr: "Seviye ve XP bilgilerini göster.",
    en: "Show level and XP information.",
  },
  "leveling.desc.rank": {
    tr: "Kişisel sıralama kartını görüntüle.",
    en: "Show your personal rank card.",
  },
  "leveling.desc.top": {
    tr: "Sunucu XP sıralaması.",
    en: "Show the guild XP leaderboard.",
  },
  "leveling.desc.xp": {
    tr: "XP sistemi ve rol ödüllerini yapılandır.",
    en: "Configure XP and level reward roles.",
  },
  "leveling.overflow": {
    tr: "XP sınırına ulaşıldı.",
    en: "The XP limit was reached.",
  },
  "leveling.title": { tr: "Executive Seviye Kartı", en: "Executive Rank Card" },
  "leveling.level": { tr: "Seviye", en: "Level" },
  "leveling.rank": { tr: "Sıra", en: "Rank" },
  "leveling.progress": {
    tr: "{level}. seviye • {xp} XP • #{rank}\n{bar} {current}/{needed}",
    en: "Level {level} • {xp} XP • #{rank}\n{bar} {current}/{needed}",
  },
  "leveling.up": {
    tr: "{user}, {level}. seviyeye ulaştın!",
    en: "{user}, you reached level {level}!",
  },
  "leveling.topTitle": { tr: "Seviye Sıralaması", en: "Level Leaderboard" },
  "leveling.empty": {
    tr: "Henüz etkinlik kaydı yok.",
    en: "No activity recorded yet.",
  },
  "leveling.rule": {
    tr: "XP: benzersiz mesajlar ve en az iki etkin, sessize/sağıra alınmamış insanın bulunduğu sesli kanallar. Komutlar XP kazandırmaz.",
    en: "XP: unique messages and voice channels with at least two active, unmuted, undeafened humans. Commands do not earn XP.",
  },
});

export function voiceEligible(
  state: VoiceState,
  excludedChannels: string[],
  excludedRoles: string[],
): boolean {
  const member = state.member;
  const channel = state.channel;
  if (
    !member ||
    member.user.bot ||
    !channel ||
    state.guild.afkChannelId === channel.id ||
    excludedChannels.includes(channel.id) ||
    member.roles.cache.some((r) => excludedRoles.includes(r.id)) ||
    state.selfMute ||
    state.serverMute ||
    state.selfDeaf ||
    state.serverDeaf
  )
    return false;
  return (
    channel.members.filter(
      (m) =>
        !m.user.bot &&
        !m.voice.selfMute &&
        !m.voice.serverMute &&
        !m.voice.selfDeaf &&
        !m.voice.serverDeaf &&
        !m.roles.cache.some((r) => excludedRoles.includes(r.id)),
    ).size >= 2
  );
}
async function applyLevelRewards(
  runtime: Runtime,
  member: GuildMember,
  before: number,
  after: number,
  locale: Locale,
): Promise<void> {
  const cfg = new LevelingService(runtime.db, runtime.settings).config(
    member.guild.id,
  );
  for (const [threshold, roleId] of Object.entries(cfg.rewardRoles))
    if (Number(threshold) <= after) {
      const role = await member.guild.roles.fetch(roleId);
      if (
        role &&
        safeRewardRole(
          role,
          member.guild.members.me?.roles.highest.position ?? 0,
        ) &&
        (await runtime.permissions.canAssignPublicRole(role)) &&
        !member.roles.cache.has(role.id)
      )
        await member.roles.add(
          role,
          `Executive level reward; user=${member.id}; level=${after}`,
        );
    }
  if (cfg.notifyChannel && after > before) {
    const channel = await member.guild.channels.fetch(cfg.notifyChannel);
    if (channel?.isTextBased() && "send" in channel)
      await channel.send({
        content: t(locale, "leveling.up", {
          user: `<@${member.id}>`,
          level: after,
        }),
        allowedMentions: { parse: [] },
        nonce: `lvl${member.id}${after}`.slice(0, 25),
        enforceNonce: true,
      });
  }
}
interface VoiceRecord {
  channel: string;
  since: number;
}
export const levelingModule: Module = {
  name: "leveling",
  register(runtime) {
    const service = new LevelingService(runtime.db, runtime.settings);
    const add = (name: string, usage: string, execute: Command["execute"]) =>
      runtime.registry.register({
        name,
        usage,
        module: "leveling",
        description: `leveling.desc.${name}`,
        execute,
      });
    add("level", ".level [@user]", async (ctx) => {
      const id = ctx.args[0] ? userId(ctx.args[0]) : ctx.user.id;
      const p = service.profile(ctx.guild.id, id);
      const progress = levelProgress(p.xp);
      const rank =
        service.leaderboard(ctx.guild.id).findIndex((r) => r.user === id) + 1;
      await ctx.reply(
        t(ctx.locale, "leveling.progress", {
          level: progress.level,
          xp: p.xp,
          rank,
          bar:
            "▓".repeat(Math.floor(progress.fraction * 15)) +
            "░".repeat(15 - Math.floor(progress.fraction * 15)),
          current: progress.current,
          needed: progress.needed,
        }),
      );
    });
    add("rank", ".rank [@user]", async (ctx) => {
      const member = ctx.args[0]
        ? await ctx.guild.members.fetch(userId(ctx.args[0]))
        : ctx.member;
      const p = service.profile(ctx.guild.id, member.id);
      const cfg = service.config(ctx.guild.id);
      const rank =
        service
          .leaderboard(ctx.guild.id)
          .findIndex((r) => r.user === member.id) + 1;
      const card = await renderRankCard({
        username: member.displayName,
        avatar: member.user.displayAvatarURL({ extension: "png", size: 128 }),
        xp: p.xp,
        rank,
        accent: cfg.accent,
        background: cfg.background,
        locale: ctx.locale,
      });
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(t(ctx.locale, "leveling.title"))
            .setColor(Number.parseInt(cfg.accent.slice(1), 16))
            .setImage("attachment://rank.png")
            .setFooter({ text: t(ctx.locale, "branding") }),
        ],
        files: [new AttachmentBuilder(card, { name: "rank.png" })],
      });
    });
    add("top", ".top", async (ctx) => {
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(t(ctx.locale, "leveling.topTitle"))
            .setDescription(
              service
                .leaderboard(ctx.guild.id)
                .slice(0, 20)
                .map(
                  (r, i) => `${i + 1}. <@${r.user}> • ${r.level} • ${r.xp} XP`,
                )
                .join("\n") || t(ctx.locale, "leveling.empty"),
            ),
        ],
      });
    });
    add(
      "xp",
      ".xp [set field value | exclude-channel #channel | exclude-role @role | reward level @role]",
      async (ctx) => {
        assert(
          runtime.permissions.canConfigure(ctx.member),
          "error.permission",
        );
        const cfg = service.config(ctx.guild.id);
        if (ctx.args[0] === "set") {
          const field = ctx.args[1];
          assert(
            field &&
              [
                "messageXp",
                "messageCooldown",
                "voiceXp",
                "voiceInterval",
                "multiplier",
                "accent",
                "background",
                "notifyChannel",
              ].includes(field),
          );
          const next = levelingConfigSchema.parse({
            ...cfg,
            [field]: ["accent", "background", "notifyChannel"].includes(field)
              ? ctx.args[2]
              : Number(ctx.args[2]),
          });
          runtime.settings.setModuleConfig(ctx.guild.id, "leveling", next);
        } else if (
          ctx.args[0] === "exclude-channel" ||
          ctx.args[0] === "exclude-role"
        ) {
          const field =
            ctx.args[0] === "exclude-channel"
              ? "excludedChannels"
              : "excludedRoles";
          const id = userId(ctx.args[1]);
          cfg[field] = cfg[field].includes(id)
            ? cfg[field].filter((v) => v !== id)
            : [...cfg[field], id];
          runtime.settings.setModuleConfig(ctx.guild.id, "leveling", cfg);
        } else if (ctx.args[0] === "reward") {
          const level = integer(ctx.args[1], 1, 10000);
          const role = await ctx.guild.roles.fetch(userId(ctx.args[2]));
          assert(
            role &&
              safeRewardRole(
                role,
                ctx.guild.members.me?.roles.highest.position ?? 0,
              ) &&
              (await runtime.permissions.canAssignPublicRole(role)),
            "economy.roleUnsafe",
          );
          cfg.rewardRoles[String(level)] = role.id;
          runtime.settings.setModuleConfig(ctx.guild.id, "leveling", cfg);
        } else {
          assert(ctx.args.length === 0);
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("XP")
                .setDescription(
                  Object.entries(cfg)
                    .map(([k, v]) => `\`${k}\`: ${JSON.stringify(v)}`)
                    .join("\n")
                    .slice(0, 3500),
                )
                .setFooter({ text: t(ctx.locale, "leveling.rule") }),
            ],
          });
          return;
        }
        await ctx.reply(t(ctx.locale, "common.ok"));
      },
    );
    runtime.messageHooks.push({
      module: "leveling",
      handle: async (message) => {
        if (
          !message.guild ||
          !message.member ||
          message.author.bot ||
          message.webhookId ||
          message.content.startsWith(".") ||
          message.content.trim().length < 3
        )
          return;
        const cfg = service.config(message.guild.id);
        if (
          cfg.excludedChannels.includes(message.channelId) ||
          message.member.roles.cache.some((r) =>
            cfg.excludedRoles.includes(r.id),
          )
        )
          return;
        const before = levelFor(
          service.profile(message.guild.id, message.author.id).xp,
        );
        const hash = createHash("sha256")
          .update(
            message.content.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim(),
          )
          .digest("hex");
        const p = service.message(
          message.guild.id,
          message.author.id,
          hash,
          message.id,
        );
        if (
          p &&
          (Object.keys(cfg.rewardRoles).length > 0 ||
            (cfg.notifyChannel && levelFor(p.xp) > before))
        )
          runtime.scheduler.schedule(
            message.guild.id,
            "leveling",
            "leveling.rewards",
            Date.now(),
            { user: message.author.id, before, after: levelFor(p.xp) },
            `levelreward:${message.author.id}:${levelFor(p.xp)}`,
          );
      },
    });
    const ensureVoice = (state: VoiceState) => {
      const cfg = service.config(state.guild.id);
      if (!voiceEligible(state, cfg.excludedChannels, cfg.excludedRoles)) {
        runtime.db.delete(state.guild.id, "voiceActivity", state.id);
        return;
      }
      const prev = runtime.db.get<VoiceRecord>(
        state.guild.id,
        "voiceActivity",
        state.id,
      );
      const record =
        prev?.channel === state.channelId
          ? prev
          : { channel: state.channelId!, since: Date.now() };
      runtime.db.set(state.guild.id, "voiceActivity", state.id, record);
      runtime.scheduler.schedule(
        state.guild.id,
        "leveling",
        "leveling.voice",
        Date.now() + cfg.voiceInterval,
        { user: state.id, channel: record.channel },
        `voice:${state.id}:${Math.floor(Date.now() / cfg.voiceInterval)}`,
      );
    };
    runtime.voiceHooks.push({
      module: "leveling",
      handle: async (oldState, newState) => {
        const members = new Map<string, VoiceState>();
        for (const channel of [oldState.channel, newState.channel])
          if (channel)
            for (const m of channel.members.values())
              members.set(m.id, m.voice);
        members.set(newState.id, newState);
        for (const state of members.values()) ensureVoice(state);
      },
    });
    runtime.scheduler.register("leveling.voice", async (job) => {
      const payload = job.payload as { user: string; channel: string };
      const guild = runtime.client.guilds.cache.get(job.guild);
      if (!guild) return;
      const member = guild.members.cache.get(payload.user);
      if (!member) return;
      const cfg = service.config(job.guild);
      if (
        !voiceEligible(member.voice, cfg.excludedChannels, cfg.excludedRoles)
      ) {
        runtime.db.delete(job.guild, "voiceActivity", member.id);
        return;
      }
      const record = runtime.db.get<VoiceRecord>(
        job.guild,
        "voiceActivity",
        member.id,
      );
      if (!record || record.channel !== member.voice.channelId) return;
      const now = Date.now();
      if (
        now - Math.max(record.since, runtime.startedAt) >=
        cfg.voiceInterval
      ) {
        const before = levelFor(service.profile(job.guild, member.id).xp);
        const p = service.voice(
          job.guild,
          member.id,
          `voice:${member.id}:${Math.floor(now / cfg.voiceInterval)}`,
        );
        if (
          Object.keys(cfg.rewardRoles).length > 0 ||
          (cfg.notifyChannel && levelFor(p.xp) > before)
        )
          runtime.scheduler.schedule(
            job.guild,
            "leveling",
            "leveling.rewards",
            now,
            { user: member.id, before, after: levelFor(p.xp) },
            `levelreward:${member.id}:${levelFor(p.xp)}`,
          );
        record.since = now;
        runtime.db.set(job.guild, "voiceActivity", member.id, record);
      }
      runtime.scheduler.schedule(
        job.guild,
        "leveling",
        "leveling.voice",
        now + cfg.voiceInterval,
        payload,
        `voice:${member.id}:${Math.floor(now / cfg.voiceInterval) + 1}`,
      );
    });
    runtime.scheduler.register("leveling.rewards", async (job) => {
      const payload = job.payload as {
        user: string;
        before: number;
        after: number;
      };
      const guild = runtime.client.guilds.cache.get(job.guild);
      if (!guild) return;
      const member = await guild.members.fetch(payload.user).catch((error) => {
        if ((error as { code?: number }).code === 10007) return;
        throw error;
      });
      if (member)
        await applyLevelRewards(
          runtime,
          member,
          payload.before,
          payload.after,
          runtime.settings.get(job.guild).locale,
        );
    });
  },
};
