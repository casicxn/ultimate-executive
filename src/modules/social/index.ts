import { createHash, randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { Command, Module } from "../../core/types.js";
import { registerTranslations, t } from "../../core/localization.js";
import { assert, duration, safeText, userId } from "../../shared.js";
import { EconomyService } from "../economy/service.js";
import { LevelingService, levelFor } from "../leveling/service.js";
import {
  SocialService,
  parseBirthday,
  nextBirthday,
  type Proposal,
  type Reminder,
} from "./service.js";
registerTranslations({
  "social.desc.profile": {
    tr: "Topluluk profilini görüntüle.",
    en: "View a community profile.",
  },
  "social.desc.rep": {
    tr: "Başka bir üyeye itibar ver.",
    en: "Give reputation to another member.",
  },
  "social.desc.ship": {
    tr: "Eğlence amaçlı uyum puanı.",
    en: "A compatibility score for fun.",
  },
  "social.desc.evlen": {
    tr: "Onay gerektiren sanal evlilik teklifi yap.",
    en: "Send a consent-based virtual marriage proposal.",
  },
  "social.desc.bosan": {
    tr: "Sanal evliliği sonlandır.",
    en: "End a virtual marriage.",
  },
  "social.desc.partner": {
    tr: "Sanal partnerini görüntüle.",
    en: "View your virtual partner.",
  },
  "social.desc.afk": {
    tr: "Uzakta durumunu ayarla.",
    en: "Set your away status.",
  },
  "social.desc.hatirlat": {
    tr: "Özel mesajla kalıcı hatırlatma oluştur.",
    en: "Create a persistent reminder delivered by DM.",
  },
  "social.desc.dogumgunu": {
    tr: "İsteğe bağlı doğum günü belirle.",
    en: "Set an optional birthday.",
  },
  "social.desc.bio": {
    tr: "Herkese açık profil açıklamasını değiştir.",
    en: "Change your public profile description.",
  },
  "social.profileTitle": {
    tr: "{user} • Topluluk Profili",
    en: "{user} • Community Profile",
  },
  "social.profileStats": {
    tr: "Seviye: {level} • XP: {xp}\nBakiye: {balance}\nİtibar: {rep}\nPartner: {partner}\nRozetler: {badges}\nDoğum günü: {birthday}",
    en: "Level: {level} • XP: {xp}\nBalance: {balance}\nReputation: {rep}\nPartner: {partner}\nBadges: {badges}\nBirthday: {birthday}",
  },
  "social.none": { tr: "Yok", en: "None" },
  "social.emptyBio": {
    tr: "Henüz açıklama eklenmedi.",
    en: "No description yet.",
  },
  "social.repSelf": {
    tr: "Kendine itibar veremezsin.",
    en: "You cannot give yourself reputation.",
  },
  "social.repGiven": {
    tr: "{user} kullanıcısına itibar verdin. Toplam: {rep}",
    en: "You gave reputation to {user}. Total: {rep}",
  },
  "social.ship": {
    tr: "{first} + {second} • %{score} uyum. Yalnızca eğlence amaçlıdır.",
    en: "{first} + {second} • {score}% compatibility. Just for fun.",
  },
  "social.self": {
    tr: "Bu işlem için başka bir üye seç.",
    en: "Choose another member for this action.",
  },
  "social.alreadyMarried": {
    tr: "Üyelerden biri zaten sanal evli.",
    en: "One of the members is already virtually married.",
  },
  "social.pending": {
    tr: "Bu üyeler için bekleyen bir teklif var.",
    en: "There is already a pending proposal for these members.",
  },
  "social.proposal": {
    tr: "{from}, {to} kullanıcısına sanal evlilik teklif ediyor. Yalnızca davetli yanıtlayabilir. Süre: 2 dakika.",
    en: "{from} proposes a virtual marriage to {to}. Only the invited member can answer. Expires in 2 minutes.",
  },
  "social.accepted": {
    tr: "{from} ve {to} sanal olarak evlendi.",
    en: "{from} and {to} are now virtually married.",
  },
  "social.rejected": {
    tr: "Sanal evlilik teklifi reddedildi.",
    en: "The virtual marriage proposal was declined.",
  },
  "social.notMarried": {
    tr: "Bu sunucuda sanal evliliğin yok.",
    en: "You have no virtual marriage in this guild.",
  },
  "social.partner": {
    tr: "Sanal partnerin: {partner}",
    en: "Your virtual partner: {partner}",
  },
  "social.divorceQuestion": {
    tr: "Sanal evliliğini sonlandırmak istediğine emin misin?",
    en: "Are you sure you want to end your virtual marriage?",
  },
  "social.divorceButton": { tr: "Evliliği sonlandır", en: "End marriage" },
  "social.divorced": {
    tr: "Sanal evlilik sonlandırıldı.",
    en: "The virtual marriage has ended.",
  },
  "social.afkSet": {
    tr: "Uzakta durumun kaydedildi: {reason}",
    en: "Your away status was saved: {reason}",
  },
  "social.afkDefault": { tr: "Şu anda uzakta.", en: "Currently away." },
  "social.afkReturn": {
    tr: "Tekrar hoş geldin; uzakta durumun kaldırıldı.",
    en: "Welcome back; your away status was cleared.",
  },
  "social.afkNotice": {
    tr: "{user} uzakta: {reason}",
    en: "{user} is away: {reason}",
  },
  "social.reminderSet": {
    tr: "Hatırlatma oluşturuldu: `{id}` • <t:{time}:R>. Özel mesajların açık olmalı.",
    en: "Reminder created: `{id}` • <t:{time}:R>. Your DMs must be open.",
  },
  "social.reminder": { tr: "Hatırlatman: {text}", en: "Your reminder: {text}" },
  "social.reminderEmpty": {
    tr: "Bekleyen hatırlatman yok.",
    en: "You have no pending reminders.",
  },
  "social.reminderLimit": {
    tr: "En fazla 20 bekleyen hatırlatma oluşturabilirsin.",
    en: "You can have at most 20 pending reminders.",
  },
  "social.birthdaySet": {
    tr: "Doğum günün {day}/{month} olarak kaydedildi. Yıl kaydedilmez; duyurular 09:00 UTC yapılır.",
    en: "Your birthday was saved as {day}/{month}. No year is stored; announcements use 09:00 UTC.",
  },
  "social.birthday": {
    tr: "Doğum günün kutlu olsun, {user}! 🎂",
    en: "Happy birthday, {user}! 🎂",
  },
  "social.bioSaved": {
    tr: "Herkese açık profil açıklaman kaydedildi.",
    en: "Your public profile description was saved.",
  },
});
interface Afk {
  reason: string;
  at: number;
}
export const socialModule: Module = {
  name: "social",
  register(runtime) {
    const social = new SocialService(runtime.db, runtime.settings);
    const economy = new EconomyService(runtime.db, runtime.settings);
    const levels = new LevelingService(runtime.db, runtime.settings);
    const add = (
      name: string,
      usage: string,
      execute: Command["execute"],
      aliases?: string[],
    ) =>
      runtime.registry.register({
        name,
        usage,
        module: "social",
        description: `social.desc.${name}`,
        aliases,
        execute,
      });
    add(
      "profile",
      ".profile [@user]",
      async (ctx) => {
        const member = ctx.args[0]
          ? await ctx.guild.members.fetch(userId(ctx.args[0]))
          : ctx.member;
        const p = social.profile(ctx.guild.id, member.id);
        const xp = levels.profile(ctx.guild.id, member.id);
        const m = social.partner(ctx.guild.id, member.id);
        const inv = economy.inventory(ctx.guild.id, member.id);
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                t(ctx.locale, "social.profileTitle", {
                  user: safeText(member.displayName, 80),
                }),
              )
              .setThumbnail(member.user.displayAvatarURL())
              .setDescription(
                `${p.bio || t(ctx.locale, "social.emptyBio")}\n\n${t(ctx.locale, "social.profileStats", { level: levelFor(xp.xp), xp: xp.xp, balance: economy.balance(ctx.guild.id, member.id), rep: p.rep, partner: m ? `<@${m.partner}>` : t(ctx.locale, "social.none"), badges: inv.badges.slice(0, 20).join(" • ") || t(ctx.locale, "social.none"), birthday: p.birthday ? `${p.birthday.day}/${p.birthday.month}` : t(ctx.locale, "social.none") })}`.slice(
                  0,
                  4000,
                ),
              )
              .setFooter({ text: t(ctx.locale, "branding") }),
          ],
        });
      },
      ["profil"],
    );
    add("bio", ".bio description | clear", async (ctx) => {
      const p = social.profile(ctx.guild.id, ctx.user.id);
      const text = ctx.args.join(" ");
      assert(text.length > 0 && text.length <= 500, "error.input");
      p.bio = text === "clear" ? "" : safeText(text, 500);
      runtime.db.set(ctx.guild.id, "profiles", ctx.user.id, p);
      await ctx.reply(t(ctx.locale, "social.bioSaved"));
    });
    add("rep", ".rep @user", async (ctx) => {
      const id = userId(ctx.args[0]);
      const target = await ctx.guild.members.fetch(id);
      assert(!target.user.bot, "error.input");
      const rep = social.reputation(
        ctx.guild.id,
        ctx.user.id,
        id,
        ctx.requestId,
      );
      await ctx.reply(
        t(ctx.locale, "social.repGiven", { user: `<@${id}>`, rep }),
      );
    });
    add("ship", ".ship @user [@other]", async (ctx) => {
      const first = ctx.args[1] ? userId(ctx.args[0]) : ctx.user.id;
      const second = userId(ctx.args[1] ?? ctx.args[0]);
      assert(first !== second, "social.self");
      const seed = `${ctx.guild.id}:${[first, second].sort().join(":")}:${new Date().toISOString().slice(0, 10)}`;
      const score =
        createHash("sha256").update(seed).digest().readUInt16BE(0) % 101;
      await ctx.reply(
        t(ctx.locale, "social.ship", {
          first: `<@${first}>`,
          second: `<@${second}>`,
          score,
        }),
      );
    });
    add("evlen", ".evlen @user", async (ctx) => {
      const id = userId(ctx.args[0]);
      const target = await ctx.guild.members.fetch(id);
      assert(!target.user.bot, "error.input");
      const proposal = social.propose(ctx.guild.id, ctx.user.id, id);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`social:marry:${proposal.id}:yes`)
          .setLabel(t(ctx.locale, "common.accept"))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`social:marry:${proposal.id}:no`)
          .setLabel(t(ctx.locale, "common.reject"))
          .setStyle(ButtonStyle.Secondary),
      );
      await ctx.reply({
        content: t(ctx.locale, "social.proposal", {
          from: `<@${ctx.user.id}>`,
          to: `<@${id}>`,
        }),
        components: [row],
        allowedMentions: { parse: [] },
      });
      runtime.scheduler.schedule(
        ctx.guild.id,
        "social",
        "social.proposal",
        proposal.expires,
        { id: proposal.id },
        `proposal:${proposal.id}`,
      );
    });
    add("partner", ".partner", async (ctx) => {
      const m = social.partner(ctx.guild.id, ctx.user.id);
      assert(m, "social.notMarried");
      await ctx.reply(
        t(ctx.locale, "social.partner", { partner: `<@${m.partner}>` }),
      );
    });
    add("bosan", ".bosan", async (ctx) => {
      const marriage = social.partner(ctx.guild.id, ctx.user.id);
      assert(marriage, "social.notMarried");
      const id = randomUUID();
      runtime.db.set(ctx.guild.id, "divorceConfirmations", id, {
        user: ctx.user.id,
        proposal: marriage.proposal,
        expires: Date.now() + 60000,
      });
      await ctx.reply({
        content: t(ctx.locale, "social.divorceQuestion"),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`social:divorce:${id}:yes`)
              .setLabel(t(ctx.locale, "social.divorceButton"))
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`social:divorce:${id}:no`)
              .setLabel(t(ctx.locale, "common.cancel"))
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
    });
    runtime.interactions.set("social", {
      module: "social",
      handle: async (interaction) => {
        assert(interaction.isButton() && interaction.guildId, "error.input");
        const [, action, id, answer] = interaction.customId.split(":");
        assert(id && ["yes", "no"].includes(answer ?? ""), "error.input");
        const locale = runtime.settings.get(interaction.guildId).locale;
        if (action === "marry") {
          const proposal = social.answer(
            interaction.guildId,
            id,
            interaction.user.id,
            answer === "yes",
          );
          await interaction.update({
            content:
              proposal.status === "accepted"
                ? t(locale, "social.accepted", {
                    from: `<@${proposal.from}>`,
                    to: `<@${proposal.to}>`,
                  })
                : t(locale, "social.rejected"),
            components: [],
            allowedMentions: { parse: [] },
          });
        } else if (action === "divorce") {
          const record = runtime.db.get<{
            user: string;
            proposal: string;
            expires: number;
          }>(interaction.guildId, "divorceConfirmations", id);
          assert(record && record.expires > Date.now(), "error.expired");
          assert(record.user === interaction.user.id, "error.permission");
          assert(
            social.partner(interaction.guildId, interaction.user.id)
              ?.proposal === record.proposal,
            "error.expired",
          );
          if (answer === "yes")
            social.divorce(interaction.guildId, interaction.user.id);
          runtime.db.delete(interaction.guildId, "divorceConfirmations", id);
          await interaction.update({
            content: t(
              locale,
              answer === "yes" ? "social.divorced" : "common.cancel",
            ),
            components: [],
          });
        } else assert(false, "error.input");
      },
    });
    runtime.scheduler.register("social.proposal", async (job) => {
      const { id } = job.payload as { id: string };
      const p = runtime.db.get<Proposal>(job.guild, "proposals", id);
      if (p && p.status === "pending") {
        p.status = "expired";
        runtime.db.set(job.guild, "proposals", id, p);
      }
    });
    add("afk", ".afk [reason]", async (ctx) => {
      const reason =
        safeText(ctx.args.join(" "), 200) || t(ctx.locale, "social.afkDefault");
      runtime.db.set<Afk>(ctx.guild.id, "afk", ctx.user.id, {
        reason,
        at: Date.now(),
      });
      await ctx.reply(t(ctx.locale, "social.afkSet", { reason }));
    });
    runtime.messageHooks.push({
      module: "social",
      handle: async (message) => {
        if (!message.guild || message.author.bot || message.webhookId) return;
        const locale = runtime.settings.get(message.guild.id).locale;
        if (
          runtime.db.get(message.guild.id, "afk", message.author.id) &&
          !/^\.afk(?:\s|$)/i.test(message.content)
        ) {
          runtime.db.delete(message.guild.id, "afk", message.author.id);
          if (message.channel.isSendable())
            await message.channel.send({
              content: t(locale, "social.afkReturn"),
              allowedMentions: { parse: [] },
            });
        }
        const lines: string[] = [];
        for (const user of message.mentions.users.values()) {
          const afk = runtime.db.get<Afk>(message.guild.id, "afk", user.id);
          if (!afk) continue;
          const key = `${message.channelId}:${user.id}`;
          const last =
            runtime.db.get<number>(message.guild.id, "afkNotices", key) ?? 0;
          if (Date.now() - last < 60000) continue;
          runtime.db.set(message.guild.id, "afkNotices", key, Date.now());
          lines.push(
            t(locale, "social.afkNotice", {
              user: safeText(user.username, 40),
              reason: afk.reason,
            }),
          );
          if (lines.length >= 3) break;
        }
        if (lines.length && message.channel.isSendable())
          await message.channel.send({
            content: lines.join("\n"),
            allowedMentions: { parse: [] },
          });
      },
    });
    add(
      "hatirlat",
      ".hatirlat duration text | list | cancel id",
      async (ctx) => {
        if (ctx.args[0] === "list") {
          const reminders = runtime.db
            .list<Reminder>(ctx.guild.id, "reminders")
            .filter(
              (r) =>
                r.value.user === ctx.user.id && r.value.status === "pending",
            );
          await ctx.reply(
            reminders
              .map(
                (r) =>
                  `\`${r.key}\` • <t:${Math.floor(r.value.due / 1000)}:R> • ${r.value.text}`,
              )
              .join("\n")
              .slice(0, 1900) || t(ctx.locale, "social.reminderEmpty"),
          );
          return;
        }
        if (ctx.args[0] === "cancel") {
          const id = ctx.args[1];
          assert(id);
          const record = runtime.db.get<Reminder>(
            ctx.guild.id,
            "reminders",
            id,
          );
          assert(record && record.user === ctx.user.id, "error.permission");
          assert(record.status === "pending", "error.expired");
          record.status = "cancelled";
          runtime.db.set(ctx.guild.id, "reminders", id, record);
          runtime.scheduler.cancel(ctx.guild.id, `reminder:${id}`);
          await ctx.reply(t(ctx.locale, "common.ok"));
          return;
        }
        const delay = duration(ctx.args[0], 365 * 86400000);
        const text = safeText(ctx.args.slice(1).join(" "), 1000);
        assert(text.length > 0);
        assert(
          runtime.db
            .list<Reminder>(ctx.guild.id, "reminders")
            .filter(
              (r) =>
                r.value.user === ctx.user.id && r.value.status === "pending",
            ).length < 20,
          "social.reminderLimit",
        );
        const record: Reminder = {
          id: randomUUID(),
          user: ctx.user.id,
          text,
          due: Date.now() + delay,
          status: "pending",
          channel: ctx.channel.id,
        };
        runtime.db.transaction(() => {
          runtime.db.set(ctx.guild.id, "reminders", record.id, record);
          runtime.scheduler.schedule(
            ctx.guild.id,
            "social",
            "social.reminder",
            record.due,
            { id: record.id },
            `reminder:${record.id}`,
          );
        });
        await ctx.reply(
          t(ctx.locale, "social.reminderSet", {
            id: record.id,
            time: Math.floor(record.due / 1000),
          }),
        );
      },
      ["remind"],
    );
    runtime.scheduler.register("social.reminder", async (job) => {
      const { id } = job.payload as { id: string };
      const record = runtime.db.get<Reminder>(job.guild, "reminders", id);
      if (!record || record.status !== "pending") return;
      const user = await runtime.client.users.fetch(record.user);
      // Durable at-least-once delivery. Discord's enforced nonce suppresses recent retry duplicates.
      try {
        await user.send({
          content: t(
            runtime.settings.get(job.guild).locale,
            "social.reminder",
            { text: record.text },
          ),
          allowedMentions: { parse: [] },
          nonce: id.replace(/-/g, "").slice(0, 25),
          enforceNonce: true,
        });
        record.status = "sent";
        runtime.db.set(job.guild, "reminders", id, record);
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code === 50007) {
          record.status = "failed";
          runtime.db.set(job.guild, "reminders", id, record);
          runtime.logger.info(
            { reminder: id },
            "Reminder could not be delivered: DMs closed",
          );
        } else {
          throw err;
        }
      }
    });
    add("dogumgunu", ".dogumgunu DD-MM | clear", async (ctx) => {
      const p = social.profile(ctx.guild.id, ctx.user.id);
      if (ctx.args[0] === "clear") {
        delete p.birthday;
        runtime.db.set(ctx.guild.id, "profiles", ctx.user.id, p);
        await ctx.reply(t(ctx.locale, "common.ok"));
        return;
      }
      p.birthday = parseBirthday(ctx.args[0] ?? "");
      runtime.db.set(ctx.guild.id, "profiles", ctx.user.id, p);
      const due = nextBirthday(p.birthday.day, p.birthday.month);
      runtime.scheduler.schedule(
        ctx.guild.id,
        "social",
        "social.birthday",
        due,
        { user: ctx.user.id, ...p.birthday },
        `birthday:${ctx.user.id}:${due}`,
      );
      await ctx.reply(t(ctx.locale, "social.birthdaySet", p.birthday));
    });
    runtime.scheduler.register("social.birthday", async (job) => {
      const { user, day, month } = job.payload as {
        user: string;
        day: number;
        month: number;
      };
      const p = social.profile(job.guild, user);
      if (p.birthday?.day !== day || p.birthday.month !== month) return;
      const cfg = social.config(job.guild);
      if (cfg.birthdayChannel) {
        const guild = runtime.client.guilds.cache.get(job.guild);
        if (guild) {
          const member = await guild.members.fetch(user).catch(() => undefined);
          const channel = await guild.channels.fetch(cfg.birthdayChannel);
          if (member && channel?.isTextBased() && "send" in channel)
            await channel.send({
              content: t(
                runtime.settings.get(job.guild).locale,
                "social.birthday",
                { user: `<@${user}>` },
              ),
              allowedMentions: { parse: [] },
            });
        }
      }
      const due = nextBirthday(day, month);
      runtime.scheduler.schedule(
        job.guild,
        "social",
        "social.birthday",
        due,
        { user, day, month },
        `birthday:${user}:${due}`,
      );
    });
  },
};
