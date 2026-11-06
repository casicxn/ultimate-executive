import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import type { Module } from "../../core/types.js";
import { t, registerTranslations } from "../../core/localization.js";
import { assert, safeText } from "../../shared.js";
import { z } from "zod";
registerTranslations({
  "welcome.join": {
    tr: "{user}, {server} sunucusuna hoş geldin!",
    en: "Welcome to {server}, {user}!",
  },
  "welcome.leave": {
    tr: "{user} sunucudan ayrıldı.",
    en: "{user} left the server.",
  },
  "welcome.command": {
    tr: "Karşılama ve ayrılma mesajlarını yapılandır",
    en: "Configure welcome and goodbye messages",
  },
});
export interface WelcomeConfig {
  channel?: string;
  goodbyeChannel?: string;
  autoRole?: string;
  joinTemplate?: string;
  leaveTemplate?: string;
  image?: string;
}
export const welcomeModule: Module = {
  name: "welcome",
  register(r) {
    r.registry.register({
      name: "welcome",
      module: "welcome",
      description: "welcome.command",
      usage:
        ".welcome join|leave|role|template|leavetemplate|image <id|metin|https-url>",
      permission: "config",
      async execute(ctx) {
        const [action, ...rest] = ctx.args;
        const config = r.settings.moduleConfig<WelcomeConfig>(
          ctx.guild.id,
          "welcome",
          {},
        );
        if (action === "template" || action === "leavetemplate") {
          const text = rest.join(" ");
          assert(text.length > 0 && text.length <= 1500);
          config[action === "template" ? "joinTemplate" : "leaveTemplate"] =
            safeText(text);
        } else if (action === "image") {
          const url = new URL(z.url().parse(rest.join("")));
          assert(url.protocol === "https:" && url.href.length <= 1000);
          config.image = url.href;
        } else if (action === "join" || action === "leave") {
          const id = rest[0]?.replace(/[<#>]/g, "");
          assert(id);
          const channel = await ctx.guild.channels.fetch(id);
          assert(channel?.isTextBased());
          config[action === "join" ? "channel" : "goodbyeChannel"] = id;
        } else if (action === "role") {
          const id = rest[0]?.replace(/[<@&>]/g, "");
          assert(id);
          const role = await ctx.guild.roles.fetch(id);
          assert(
            role &&
              !role.managed &&
              role.id !== ctx.guild.id &&
              role.permissions.bitfield === 0n &&
              (await r.permissions.canAssignPublicRole(role)),
            "error.permission",
          );
          assert(
            ctx.guild.members.me &&
              ctx.guild.members.me.roles.highest.comparePositionTo(role) > 0,
            "error.permission",
          );
          config.autoRole = role.id;
        } else assert(false);
        r.settings.setModuleConfig(ctx.guild.id, "welcome", config);
        await ctx.reply(t(ctx.locale, "common.ok"));
      },
    });
    r.memberHooks.push({
      module: "welcome",
      async join(member) {
        const config = r.settings.moduleConfig<WelcomeConfig>(
            member.guild.id,
            "welcome",
            {},
          ),
          l = r.settings.get(member.guild.id).locale;
        if (config.autoRole && !member.user.bot) {
          const role = await member.guild.roles.fetch(config.autoRole);
          if (
            role &&
            (await r.permissions.canAssignPublicRole(role)) &&
            !role.managed &&
            role.permissions.bitfield === 0n &&
            role.id !== member.guild.id &&
            member.guild.members.me?.permissions.has(
              PermissionFlagsBits.ManageRoles,
            ) &&
            member.guild.members.me.roles.highest.comparePositionTo(role) > 0
          )
            await member.roles.add(role, "Executive welcome auto-role");
        }
        if (!config.channel) return;
        const channel = await member.guild.channels.fetch(config.channel);
        if (!channel?.isSendable()) return;
        const description = (config.joinTemplate ?? t(l, "welcome.join"))
          .replaceAll("{user}", safeText(member.user.username))
          .replaceAll("{server}", safeText(member.guild.name));
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setDescription(description)
              .setImage(config.image ?? null)
              .setFooter({ text: t(l, "branding") }),
          ],
          allowedMentions: { parse: [] },
        });
      },
      async leave(member) {
        const config = r.settings.moduleConfig<WelcomeConfig>(
          member.guild.id,
          "welcome",
          {},
        );
        if (!config.goodbyeChannel) return;
        const channel = await member.guild.channels.fetch(
          config.goodbyeChannel,
        );
        if (!channel?.isSendable()) return;
        const l = r.settings.get(member.guild.id).locale;
        await channel.send({
          content: (config.leaveTemplate ?? t(l, "welcome.leave"))
            .replaceAll("{user}", safeText(member.user.username))
            .replaceAll("{server}", safeText(member.guild.name)),
          allowedMentions: { parse: [] },
        });
      },
    });
  },
};
