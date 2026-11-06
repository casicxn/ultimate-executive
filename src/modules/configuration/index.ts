import type { Module } from "../../core/types.js";
import { registerTranslations, t } from "../../core/localization.js";
import { assert, userId } from "../../shared.js";
import { socialConfigSchema } from "../social/service.js";
registerTranslations({
  "config.description": {
    tr: "Sunucu modülleri, komutlar ve sosyal ayarlar",
    en: "Guild modules, commands, and social settings",
  },
  "config.usage": {
    tr: ".config module <modül> on|off • command <ad> on|off • language tr|en • social <alan> <değer> • giveaways maxEntries|changeVotes <değer> • utilities suggestionThreads on|off • entertainment sessionMs <ms> • list",
    en: ".config module <module> on|off • command <name> on|off • language tr|en • social <field> <value> • giveaways maxEntries|changeVotes <value> • utilities suggestionThreads on|off • entertainment sessionMs <ms> • list",
  },
  "config.list": {
    tr: "Kapalı modüller: {modules}\nKapalı komutlar: {commands}\nDil: {locale}",
    en: "Disabled modules: {modules}\nDisabled commands: {commands}\nLanguage: {locale}",
  },
  "language.description": {
    tr: "Sunucu dilini görüntüle veya değiştir",
    en: "View or change the server language",
  },
  "language.current": {
    tr: "Sunucu dili: {language}. Seçenekler: `.dil tr`, `.dil en`.",
    en: "Server language: {language}. Options: `.language tr`, `.language en`.",
  },
  "language.saved": {
    tr: "Sunucu dili Türkçe olarak kaydedildi.",
    en: "Server language set to English.",
  },
  "system.description": {
    tr: "Bot sahibi için uygulama durumu",
    en: "Application health for the bot owner",
  },
});
export const configurationModule: Module = {
  name: "configuration",
  register(r) {
    r.registry.register({
      name: "language",
      aliases: ["dil", "lang"],
      module: "configuration",
      description: "language.description",
      usage: ".language [tr|en]",
      permission: "config",
      async execute(ctx) {
        const [locale] = ctx.args;
        if (locale === undefined) {
          await ctx.reply(
            t(ctx.locale, "language.current", {
              language: ctx.locale === "tr" ? "Türkçe" : "English",
            }),
          );
          return;
        }
        assert(ctx.args.length === 1 && (locale === "tr" || locale === "en"));
        r.settings.update(ctx.guild.id, { locale });
        r.logger.info(
          { guild: ctx.guild.id, actor: ctx.user.id, locale },
          "Guild language updated",
        );
        await ctx.reply(t(locale, "language.saved"));
      },
    });
    r.registry.register({
      name: "config",
      aliases: ["ayar"],
      module: "configuration",
      description: "config.description",
      usage: ".config",
      permission: "config",
      async execute(ctx) {
        const [action, key, value] = ctx.args;
        const current = r.settings.get(ctx.guild.id);
        if (action === "list") {
          await ctx.reply(
            t(ctx.locale, "config.list", {
              modules: current.disabledModules.join(", ") || "—",
              commands: current.disabledCommands.join(", ") || "—",
              locale: current.locale,
            }),
          );
          return;
        }
        if (action === "module") {
          assert(key && value && (value === "on" || value === "off"));
          assert(r.registry.all().some((c) => c.module === key));
          assert(!["configuration", "panel"].includes(key));
          r.settings.update(ctx.guild.id, {
            disabledModules:
              value === "on"
                ? current.disabledModules.filter((m) => m !== key)
                : [...new Set([...current.disabledModules, key])],
          });
        } else if (action === "command") {
          const c = r.registry.find(key ?? "");
          assert(c && value && (value === "on" || value === "off"));
          assert(!["config", "panel"].includes(c.name));
          r.settings.update(ctx.guild.id, {
            disabledCommands:
              value === "on"
                ? current.disabledCommands.filter((n) => n !== c.name)
                : [...new Set([...current.disabledCommands, c.name])],
          });
        } else if (action === "language") {
          assert(key === "tr" || key === "en");
          r.settings.update(ctx.guild.id, { locale: key });
        } else if (action === "social") {
          assert(
            key &&
              value &&
              ["repCooldown", "marriageEnabled", "birthdayChannel"].includes(
                key,
              ),
          );
          let parsed: string | number | boolean = value;
          if (key === "repCooldown") parsed = Number(value);
          if (key === "marriageEnabled") {
            assert(value === "on" || value === "off");
            parsed = value === "on";
          }
          if (key === "birthdayChannel") {
            parsed = userId(value);
            const channel = await ctx.guild.channels.fetch(parsed);
            assert(channel?.isTextBased());
          }
          const next = socialConfigSchema.parse({
            ...r.settings.moduleConfig(ctx.guild.id, "social", {}),
            [key]: parsed,
          });
          r.settings.setModuleConfig(ctx.guild.id, "social", next);
        } else if (action === "giveaways") {
          assert(key && value && ["maxEntries", "changeVotes"].includes(key));
          let parsed: number | boolean;
          if (key === "maxEntries") {
            parsed = Number(value);
            assert(
              Number.isSafeInteger(parsed) && parsed >= 2 && parsed <= 100000,
            );
          } else {
            assert(value === "on" || value === "off");
            parsed = value === "on";
          }
          r.settings.setModuleConfig(ctx.guild.id, "giveaways", {
            ...r.settings.moduleConfig(ctx.guild.id, "giveaways", {}),
            [key]: parsed,
          });
        } else if (action === "utilities") {
          assert(
            key === "suggestionThreads" && (value === "on" || value === "off"),
          );
          r.settings.setModuleConfig(ctx.guild.id, "utilities", {
            ...r.settings.moduleConfig(ctx.guild.id, "utilities", {}),
            suggestionThreads: value === "on",
          });
        } else if (action === "entertainment") {
          assert(key === "sessionMs" && value);
          const sessionMs = Number(value);
          assert(
            Number.isSafeInteger(sessionMs) &&
              sessionMs >= 30000 &&
              sessionMs <= 3600000,
          );
          r.settings.setModuleConfig(ctx.guild.id, "entertainment", {
            ...r.settings.moduleConfig(ctx.guild.id, "entertainment", {}),
            sessionMs,
          });
        } else {
          await ctx.reply(t(ctx.locale, "config.usage"));
          return;
        }
        r.logger.info(
          { guild: ctx.guild.id, actor: ctx.user.id, action, key, value },
          "Guild configuration updated",
        );
        await ctx.reply(t(r.settings.get(ctx.guild.id).locale, "common.ok"));
      },
    });
    r.registry.register({
      name: "system",
      module: "configuration",
      description: "system.description",
      usage: ".system",
      async execute(ctx) {
        assert(ctx.user.id === r.ownerId, "error.permission");
        await ctx.reply(
          `Ultimate Executive • ${Math.floor((Date.now() - r.startedAt) / 1000)}s • ${Math.round(process.memoryUsage().rss / 1048576)}MB • ${r.client.guilds.cache.size}`,
        );
      },
    });
  },
};
