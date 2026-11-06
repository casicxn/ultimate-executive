import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import { randomUUID } from "node:crypto";
import type { Module, Runtime } from "../../core/types.js";
import { registerTranslations, t } from "../../core/localization.js";
import { assert, safeText, userId, duration } from "../../shared.js";
import { cleanupGuild, scheduleRetention } from "./retention.js";
registerTranslations({
  "utilities.help": {
    tr: "Komut listesi ve kullanımları",
    en: "Command list and usage",
  },
  "utilities.ping": {
    tr: "Gecikme: {ms} ms • Çalışma süresi: {seconds} sn",
    en: "Latency: {ms}ms • Uptime: {seconds}s",
  },
  "utilities.info": {
    tr: "Topluluk araçları ve bilgiler",
    en: "Community utilities and information",
  },
  "utilities.roles": {
    tr: "Rol seçimi • açmak/kaldırmak için tıklayın",
    en: "Self roles • click to add/remove",
  },
  "utilities.suggest": { tr: "Öneri", en: "Suggestion" },
  "utilities.yes": { tr: "Destekle", en: "Support" },
  "utilities.no": { tr: "Karşı çık", en: "Oppose" },
  "utilities.approve": { tr: "Onaylandı", en: "Approved" },
  "utilities.reject": { tr: "Reddedildi", en: "Rejected" },
  "utilities.suggestion": {
    tr: "{body}\n\nDestek: {yes} • Karşı: {no}\nDurum: {status}",
    en: "{body}\n\nSupport: {yes} • Oppose: {no}\nStatus: {status}",
  },
  "utilities.pending": { tr: "İnceleniyor", en: "Pending" },
  "utilities.custom": {
    tr: "Özel komut, otomatik yanıt ve duyuru ayarları",
    en: "Custom commands, auto responses, and announcements",
  },
  "utilities.sent": {
    tr: "Duyuru kaydedildi. Kimlik: {id}",
    en: "Announcement saved. ID: {id}",
  },
  "utilities.discussion": {
    tr: "Öneri tartışması • {id}",
    en: "Suggestion discussion • {id}",
  },
  "utilities.retention": {
    tr: "Temizleme: {days} günden eski tamamlanmış kayıtlar. Silinen: {count}",
    en: "Cleanup: completed records older than {days} days. Deleted: {count}",
  },
});
interface Suggestion {
  id: string;
  body: string;
  author: string;
  channel: string;
  message?: string;
  thread?: string;
  votes: Record<string, boolean>;
  status: "pending" | "approve" | "reject";
}
interface RoleMenu {
  roles: string[];
}
const suggestionLocks = new Map<string, Promise<unknown>>();
async function lockedSuggestion<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = suggestionLocks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(fn);
  suggestionLocks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (suggestionLocks.get(key) === pending) suggestionLocks.delete(key);
  }
}
function roleSafe(r: Runtime, guild: string, id: string): boolean {
  const role = r.client.guilds.cache.get(guild)?.roles.cache.get(id);
  return (
    !!role &&
    !role.managed &&
    role.id !== guild &&
    role.permissions.bitfield === 0n
  );
}
export const utilitiesModule: Module = {
  name: "utilities",
  register(r) {
    r.registry.register({
      name: "help",
      aliases: ["yardim", "yardım"],
      module: "utilities",
      description: "utilities.help",
      usage: ".help [sayfa/page]",
      async execute(ctx) {
        const commands = r.registry
          .all()
          .filter(
            (c) =>
              r.settings.enabled(ctx.guild.id, c.module) &&
              !r.settings.get(ctx.guild.id).disabledCommands.includes(c.name),
          );
        const page = Math.max(
          0,
          Math.min(
            Math.ceil(commands.length / 15) - 1,
            Number(ctx.args[0] ?? 1) - 1,
          ),
        );
        assert(Number.isInteger(page));
        const lines = commands
          .slice(page * 15, page * 15 + 15)
          .map((c) => `**${c.usage}**\n${t(ctx.locale, c.description)}`);
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                `Ultimate Executive • ${page + 1}/${Math.ceil(commands.length / 15)}`,
              )
              .setDescription(lines.join("\n\n").slice(0, 4000))
              .setFooter({ text: t(ctx.locale, "branding") }),
          ],
        });
      },
    });
    r.registry.register({
      name: "ping",
      aliases: ["uptime"],
      module: "utilities",
      description: "utilities.info",
      usage: ".ping",
      async execute(ctx) {
        await ctx.reply(
          t(ctx.locale, "utilities.ping", {
            ms: Math.max(0, r.client.ws.ping),
            seconds: Math.floor((Date.now() - r.startedAt) / 1000),
          }),
        );
      },
    });
    for (const name of [
      "serverinfo",
      "userinfo",
      "avatar",
      "roleinfo",
      "channelinfo",
    ])
      r.registry.register({
        name,
        module: "utilities",
        description: "utilities.info",
        usage: `.${name} [id]`,
        async execute(ctx) {
          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setFooter({ text: t(ctx.locale, "branding") });
          if (name === "serverinfo")
            embed
              .setTitle(safeText(ctx.guild.name))
              .setThumbnail(ctx.guild.iconURL())
              .setDescription(
                `ID: ${ctx.guild.id}\n👥 ${ctx.guild.memberCount}\n# ${ctx.guild.channels.cache.size}\n🎭 ${ctx.guild.roles.cache.size}`,
              );
          else if (name === "userinfo" || name === "avatar") {
            const member = ctx.args[0]
              ? await ctx.guild.members.fetch(userId(ctx.args[0]))
              : ctx.member;
            embed
              .setTitle(safeText(member.user.username))
              .setDescription(
                `ID: ${member.id}\n<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`,
              )
              .setImage(member.displayAvatarURL({ size: 512 }));
          } else if (name === "roleinfo") {
            const role = await ctx.guild.roles.fetch(userId(ctx.args[0]));
            assert(role);
            embed
              .setTitle(safeText(role.name))
              .setDescription(
                `ID: ${role.id}\n#${role.color.toString(16).padStart(6, "0")}`,
              );
          } else {
            const channel = ctx.args[0]
              ? await ctx.guild.channels.fetch(userId(ctx.args[0]))
              : ctx.channel;
            assert(channel);
            embed.setTitle("Channel").setDescription(`ID: ${channel.id}`);
          }
          await ctx.reply({ embeds: [embed] });
        },
      });
    r.registry.register({
      name: "embed",
      module: "utilities",
      description: "utilities.info",
      usage: ".embed <başlık | açıklama>",
      permission: "config",
      async execute(ctx) {
        const [title, body] = ctx.args.join(" ").split("|");
        assert(title && body);
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(safeText(title, 256))
              .setDescription(safeText(body, 3500))
              .setFooter({ text: t(ctx.locale, "branding") }),
          ],
        });
      },
    });
    r.registry.register({
      name: "selfrole",
      module: "utilities",
      description: "utilities.roles",
      usage: ".selfrole [buttons|select] <roleId...>",
      permission: "config",
      async execute(ctx) {
        const mode = ctx.args[0] === "select" ? "select" : "buttons";
        const args = ["buttons", "select"].includes(ctx.args[0] ?? "")
          ? ctx.args.slice(1)
          : ctx.args;
        const roles = args.map(userId);
        assert(roles.length > 0 && roles.length <= 20);
        for (const id of roles) {
          await ctx.guild.roles.fetch(id);
          assert(
            roleSafe(r, ctx.guild.id, id) &&
              (await r.permissions.canAssignPublicRole(
                ctx.guild.roles.cache.get(id)!,
              )),
            "error.permission",
          );
          assert(
            ctx.guild.members.me &&
              ctx.guild.members.me.roles.highest.comparePositionTo(
                ctx.guild.roles.cache.get(id)!,
              ) > 0,
            "error.permission",
          );
        }
        const id = randomUUID().slice(0, 12);
        r.db.set<RoleMenu>(ctx.guild.id, "roleMenus", id, { roles });
        if (mode === "select") {
          await ctx.reply({
            content: t(ctx.locale, "utilities.roles"),
            components: [
              new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(`roleselect:${id}`)
                  .setMinValues(0)
                  .setMaxValues(roles.length)
                  .addOptions(
                    roles.map((role) => ({
                      label: ctx.guild.roles.cache.get(role)!.name.slice(0, 80),
                      value: role,
                    })),
                  ),
              ),
            ],
          });
          return;
        }
        const components = [];
        for (let index = 0; index < roles.length; index += 5)
          components.push(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              roles
                .slice(index, index + 5)
                .map((role) =>
                  new ButtonBuilder()
                    .setCustomId(`role:${id}:${role}`)
                    .setLabel(
                      ctx.guild.roles.cache.get(role)!.name.slice(0, 80),
                    )
                    .setStyle(ButtonStyle.Secondary),
                ),
            ),
          );
        await ctx.reply({
          content: t(ctx.locale, "utilities.roles"),
          components,
        });
      },
    });
    r.interactions.set("role", {
      module: "utilities",
      async handle(i) {
        assert(i.isButton() && i.guild && i.guildId);
        const [, id, role] = i.customId.split(":");
        assert(
          id &&
            role &&
            r.db
              .get<RoleMenu>(i.guildId, "roleMenus", id)
              ?.roles.includes(role),
        );
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await i.guild.roles.fetch(role);
        assert(
          roleSafe(r, i.guildId, role) &&
            (await r.permissions.canAssignPublicRole(
              i.guild.roles.cache.get(role)!,
            )),
          "error.permission",
        );
        const member = await i.guild.members.fetch(i.user.id);
        const target = i.guild.roles.cache.get(role)!;
        assert(
          i.guild.members.me &&
            i.guild.members.me.roles.highest.comparePositionTo(target) > 0,
          "error.permission",
        );
        if (member.roles.cache.has(role)) await member.roles.remove(role);
        else await member.roles.add(role);
        await i.editReply(t(r.settings.get(i.guildId).locale, "common.ok"));
      },
    });
    r.interactions.set("roleselect", {
      module: "utilities",
      async handle(i) {
        assert(i.isStringSelectMenu() && i.guild && i.guildId);
        const id = i.customId.split(":")[1];
        assert(id);
        const menu = r.db.get<RoleMenu>(i.guildId, "roleMenus", id);
        assert(
          menu && i.values.every((role) => menu.roles.includes(role)),
          "error.permission",
        );
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        for (const roleId of menu.roles) {
          const role = await i.guild.roles.fetch(roleId);
          assert(
            role &&
              roleSafe(r, i.guildId, roleId) &&
              (await r.permissions.canAssignPublicRole(role)),
            "error.permission",
          );
        }
        const member = await i.guild.members.fetch(i.user.id);
        for (const roleId of menu.roles) {
          if (i.values.includes(roleId) && !member.roles.cache.has(roleId))
            await member.roles.add(roleId);
          else if (!i.values.includes(roleId) && member.roles.cache.has(roleId))
            await member.roles.remove(roleId);
        }
        await i.editReply(t(r.settings.get(i.guildId).locale, "common.ok"));
      },
    });
    r.registry.register({
      name: "suggest",
      aliases: ["oneri", "öneri"],
      module: "utilities",
      description: "utilities.suggest",
      usage: ".suggest <metin>",
      cooldown: 60000,
      async execute(ctx) {
        const body = safeText(ctx.args.join(" "));
        assert(body && ctx.channel.isSendable());
        const id = ctx.requestId;
        if (r.db.get<Suggestion>(ctx.guild.id, "suggestions", id)) {
          await ctx.reply(t(ctx.locale, "common.ok"));
          return;
        }
        const s: Suggestion = {
          id,
          body,
          author: ctx.user.id,
          channel: ctx.channel.id,
          votes: {},
          status: "pending",
        };
        r.db.set(ctx.guild.id, "suggestions", id, s);
        let message;
        try {
          message = await ctx.channel.send(suggestionView(r, ctx.guild.id, id));
          s.message = message.id;
          r.db.set(ctx.guild.id, "suggestions", id, s);
        } catch (error) {
          r.db.delete(ctx.guild.id, "suggestions", id);
          throw error;
        }
        if (
          r.settings.moduleConfig(ctx.guild.id, "utilities", {
            suggestionThreads: false,
          }).suggestionThreads &&
          typeof message.startThread === "function"
        ) {
          try {
            const thread = await message.startThread({
              name: t(ctx.locale, "utilities.discussion", { id }).slice(0, 100),
              autoArchiveDuration: 60,
              reason: `Executive suggestion=${id} author=${ctx.user.id}`,
            });
            r.db.transaction(() => {
              const latest = r.db.get<Suggestion>(
                ctx.guild.id,
                "suggestions",
                id,
              );
              if (latest) {
                latest.thread = thread.id;
                r.db.set(ctx.guild.id, "suggestions", id, latest);
              }
            });
          } catch (error) {
            r.logger.warn(
              { err: error, suggestion: id },
              "Suggestion discussion could not be created",
            );
          }
        }
        await ctx.reply(t(ctx.locale, "common.ok"));
      },
    });
    r.registry.register({
      name: "suggestion",
      module: "utilities",
      description: "utilities.suggest",
      usage: ".suggestion approve|reject <id>",
      permission: "config",
      async execute(ctx) {
        const [status, id] = ctx.args;
        assert(id && (status === "approve" || status === "reject"));
        await lockedSuggestion(`${ctx.guild.id}:${id}`, async () => {
          const s = r.db.get<Suggestion>(ctx.guild.id, "suggestions", id);
          assert(s?.channel && s.message, "error.expired");
          const channel = await ctx.guild.channels.fetch(s.channel);
          assert(channel?.isTextBased() && "messages" in channel);
          s.status = status;
          r.db.set(ctx.guild.id, "suggestions", id, s);
          await channel.messages.edit(
            s.message,
            suggestionView(r, ctx.guild.id, id),
          );
        });
        await ctx.reply(t(ctx.locale, "common.ok"));
      },
    });
    r.interactions.set("suggest", {
      module: "utilities",
      async handle(i) {
        assert(i.isButton() && i.guildId && i.guild);
        const [, id, vote] = i.customId.split(":");
        assert(id && (vote === "yes" || vote === "no"));
        const original = r.db.get<Suggestion>(i.guildId, "suggestions", id);
        assert(
          original &&
            original.channel === i.channelId &&
            original.message === i.message.id,
          "error.permission",
        );
        await i.deferUpdate();
        await lockedSuggestion(`${i.guildId}:${id}`, async () => {
          r.db.transaction(() => {
            const s = r.db.get<Suggestion>(i.guildId!, "suggestions", id);
            assert(s && s.status === "pending", "error.expired");
            s.votes[i.user.id] = vote === "yes";
            r.db.set(i.guildId!, "suggestions", id, s);
          });
          await i.editReply(suggestionView(r, i.guildId!, id));
        });
      },
    });
    for (const name of ["custom", "autoresponse"])
      r.registry.register({
        name,
        module: "utilities",
        description: "utilities.custom",
        usage: `.${name} set|delete <name> [text]`,
        permission: "config",
        async execute(ctx) {
          const [action, key, ...body] = ctx.args;
          assert(key && /^[\p{L}\p{N}_-]{1,32}$/u.test(key));
          if (name === "custom") assert(!r.registry.find(key));
          if (action === "delete")
            r.db.delete(ctx.guild.id, name, key.toLowerCase());
          else {
            assert(action === "set" && body.length > 0);
            assert(
              r.db.list(ctx.guild.id, name).length < 100 ||
                r.db.get(ctx.guild.id, name, key.toLowerCase()),
            );
            r.db.set(
              ctx.guild.id,
              name,
              key.toLowerCase(),
              safeText(body.join(" ")),
            );
          }
          await ctx.reply(t(ctx.locale, "common.ok"));
        },
      });
    r.registry.register({
      name: "announce",
      module: "utilities",
      description: "utilities.custom",
      usage: ".announce <1h> <metin> | cancel <id>",
      permission: "config",
      async execute(ctx) {
        if (ctx.args[0] === "cancel") {
          assert(ctx.args[1]);
          r.scheduler.cancel(ctx.guild.id, ctx.args[1]);
          await ctx.reply(t(ctx.locale, "common.ok"));
          return;
        }
        const due = Date.now() + duration(ctx.args.shift());
        const content = safeText(ctx.args.join(" "));
        assert(content);
        const id = r.scheduler.schedule(
          ctx.guild.id,
          "utilities",
          "announcement",
          due,
          { channel: ctx.channel.id, content },
        );
        await ctx.reply(t(ctx.locale, "utilities.sent", { id }));
      },
    });
    r.scheduler.register("announcement", async (job) => {
      const p = job.payload as {
        channel: string;
        content: string;
        sent?: boolean;
      };
      if (p.sent) return;
      const guild = await r.client.guilds.fetch(job.guild);
      const channel = await guild.channels.fetch(p.channel);
      assert(channel?.isSendable());
      await channel.send({
        content: p.content,
        allowedMentions: { parse: [] },
        nonce: job.id.replace(/-/g, "").slice(0, 25),
        enforceNonce: true,
      });
    });
    r.registry.register({
      name: "sticky",
      module: "utilities",
      description: "utilities.custom",
      usage: ".sticky set <metin> | off",
      permission: "config",
      async execute(ctx) {
        if (ctx.args[0] === "off")
          r.db.delete(ctx.guild.id, "sticky", ctx.channel.id);
        else {
          assert(ctx.args.shift() === "set");
          const text = safeText(ctx.args.join(" "));
          assert(text);
          r.db.set(ctx.guild.id, "sticky", ctx.channel.id, {
            text,
            last: 0,
            message: undefined,
          });
        }
        await ctx.reply(t(ctx.locale, "common.ok"));
      },
    });
    r.messageHooks.push({
      module: "utilities",
      async handle(m) {
        if (!m.guild || !m.channel.isSendable()) return;
        const s = r.db.get<{ text: string; last: number; message?: string }>(
          m.guild.id,
          "sticky",
          m.channel.id,
        );
        if (
          s &&
          !r.settings.get(m.guild.id).disabledCommands.includes("sticky") &&
          Date.now() - s.last > 60000
        ) {
          s.last = Date.now();
          r.db.set(m.guild.id, "sticky", m.channel.id, s);
          if (s.message)
            await m.channel.messages.delete(s.message).catch(() => undefined);
          const sent = await m.channel.send({
            content: s.text,
            allowedMentions: { parse: [] },
          });
          s.message = sent.id;
          r.db.set(m.guild.id, "sticky", m.channel.id, s);
        }
        const config = r.settings.get(m.guild.id);
        const name = m.content.startsWith(".")
          ? m.content.slice(1).split(/\s/)[0]?.toLowerCase()
          : undefined;
        const text =
          name && !r.registry.find(name)
            ? !config.disabledCommands.includes("custom")
              ? r.db.get<string>(m.guild.id, "custom", name)
              : undefined
            : !config.disabledCommands.includes("autoresponse")
              ? r.db.get<string>(
                  m.guild.id,
                  "autoresponse",
                  m.content.trim().toLowerCase(),
                )
              : undefined;
        if (!text) return;
        const key = `${m.author.id}:${m.channel.id}`;
        const next = r.db.get<number>(m.guild.id, "autoCooldown", key) ?? 0;
        if (next > Date.now()) return;
        r.db.set(m.guild.id, "autoCooldown", key, Date.now() + 10000);
        await m.channel.send({ content: text, allowedMentions: { parse: [] } });
      },
    });
    r.registry.register({
      name: "cleanup",
      module: "utilities",
      description: "utilities.retention",
      usage: ".cleanup <30..3650 gün/days>",
      permission: "config",
      async execute(ctx) {
        const days = Number(ctx.args[0]);
        const count = cleanupGuild(r, ctx.guild.id, days);
        r.settings.setModuleConfig(ctx.guild.id, "retention", { days });
        scheduleRetention(r, ctx.guild.id);
        await ctx.reply(t(ctx.locale, "utilities.retention", { days, count }));
      },
    });
    r.scheduler.register("utilities.retention", async (job) => {
      const config = r.settings.moduleConfig<{ days?: number }>(
        job.guild,
        "retention",
        {},
      );
      if (config.days === undefined) return;
      const count = cleanupGuild(r, job.guild, config.days);
      r.logger.info(
        { guild: job.guild, count, days: config.days },
        "Guild retention cleanup completed",
      );
      scheduleRetention(r, job.guild, Date.now(), job.id);
    });
    for (const guild of r.db.scopes()) {
      const days = r.settings.moduleConfig<{ days?: number }>(
        guild,
        "retention",
        {},
      ).days;
      if (
        typeof days === "number" &&
        Number.isInteger(days) &&
        days >= 30 &&
        days <= 3650
      )
        scheduleRetention(r, guild);
    }
  },
};
function suggestionView(r: Runtime, guild: string, id: string) {
  const s = r.db.get<Suggestion>(guild, "suggestions", id)!;
  const l = r.settings.get(guild).locale;
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${t(l, "utilities.suggest")} #${id}`)
        .setColor(0x5865f2)
        .setDescription(
          t(l, "utilities.suggestion", {
            body: s.body,
            yes: Object.values(s.votes).filter(Boolean).length,
            no: Object.values(s.votes).filter((v) => !v).length,
            status: t(l, `utilities.${s.status}`),
          }),
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ["yes", "no"].map((v) =>
          new ButtonBuilder()
            .setCustomId(`suggest:${id}:${v}`)
            .setStyle(v === "yes" ? ButtonStyle.Success : ButtonStyle.Danger)
            .setLabel(t(l, `utilities.${v}`))
            .setDisabled(s.status !== "pending"),
        ),
      ),
    ],
    allowedMentions: { parse: [] as never[] },
  };
}
