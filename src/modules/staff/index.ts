import type { Module } from "../../core/types.js";
import type { Grants } from "../../core/permissions.js";
import { registerTranslations, t } from "../../core/localization.js";
import { assert, userId, integer } from "../../shared.js";
registerTranslations({
  "staff.description": {
    tr: "Komut yetkilerini, grupları ve korumaları yönetir.",
    en: "Manage command grants, groups and protections.",
  },
  "staff.usage": {
    tr: "Kullanım: .staff grant|revoke user|role ID komut... • .staff group ad komut... • .staff assign|unassign user|role ID grup... • .staff protect|unprotect user|role ID • .staff admin|unadmin ID • .staff list • .staff limit 1-100",
    en: "Usage: .staff grant|revoke user|role ID command... • .staff group name command... • .staff assign|unassign user|role ID group... • .staff protect|unprotect user|role ID • .staff admin|unadmin ID • .staff list • .staff limit 1-100",
  },
  "staff.saved": {
    tr: "Sunucu personel yetkileri kaydedildi.",
    en: "Guild staff permissions saved.",
  },
  "staff.ownerOnly": {
    tr: "Yapılandırma yöneticilerini yalnız sunucu sahibi atayabilir.",
    en: "Only the guild owner may delegate configuration managers.",
  },
  "staff.empty": {
    tr: "Özel yetki veya grup yok.",
    en: "No custom grants or groups.",
  },
  "staff.list": {
    tr: "Yetkiler ve gruplar\n{rows}",
    en: "Grants and groups\n{rows}",
  },
  "staff.unknownCommand": {
    tr: "Bu komut yetki atamaya uygun değil veya bulunamadı: {name}",
    en: "This command cannot be granted or does not exist: {name}",
  },
});
export const staffModule: Module = {
  name: "staff",
  register(runtime) {
    runtime.registry.register({
      name: "staff",
      aliases: ["yetki"],
      module: "staff",
      description: "staff.description",
      usage: ".staff",
      permission: "config",
      execute: async (ctx) => {
        assert(
          runtime.permissions.canConfigure(ctx.member),
          "error.permission",
        );
        const [operation, kind, id, ...values] = ctx.args;
        const guild = ctx.guild.id;
        const validateCommands = (names: string[]): string[] =>
          names.map((name) => {
            const command = runtime.registry.find(name);
            assert(
              command?.permission &&
                command.permission !== "config" &&
                command.module !== "staff",
              "staff.unknownCommand",
              { name },
            );
            return command.permission;
          });
        const validateSubject = async () => {
          assert(kind === "user" || kind === "role");
          const target = userId(id);
          if (kind === "role") {
            const role = await ctx.guild.roles.fetch(target);
            assert(role && role.id !== guild && !role.managed);
          } else await ctx.guild.members.fetch(target);
          return `${kind}:${target}`;
        };
        if (operation === "list") {
          const rows = [
            ...runtime.db
              .list<Grants>(guild, "grants")
              .map(
                ({ key, value }) =>
                  `${key}: ${value.commands.join(", ")} | ${value.groups.join(", ")}`,
              ),
            ...runtime.db
              .list<string[]>(guild, "permissionGroups")
              .map(({ key, value }) => `${key}: ${value.join(", ")}`),
          ];
          await ctx.reply(
            rows.length
              ? t(ctx.locale, "staff.list", {
                  rows: rows.join("\n").slice(0, 1700),
                })
              : t(ctx.locale, "staff.empty"),
          );
          return;
        }
        if (operation === "group") {
          assert(kind && /^[a-zA-Z0-9_-]{1,32}$/.test(kind));
          const names = [id, ...values].filter((value): value is string =>
            Boolean(value),
          );
          assert(names.length > 0);
          runtime.db.set(guild, "permissionGroups", kind, [
            ...new Set(validateCommands(names)),
          ]);
        } else if (
          operation === "grant" ||
          operation === "revoke" ||
          operation === "assign" ||
          operation === "unassign"
        ) {
          const key = await validateSubject();
          assert(values.length > 0);
          const assigned = operation === "assign" || operation === "unassign";
          const entries = assigned ? values : validateCommands(values);
          if (assigned)
            for (const name of entries)
              assert(runtime.db.get(guild, "permissionGroups", name));
          runtime.db.transaction(() => {
            const grant = runtime.db.get<Grants>(guild, "grants", key) ?? {
              commands: [],
              groups: [],
            };
            const field = assigned ? "groups" : "commands";
            grant[field] =
              operation === "grant" || operation === "assign"
                ? [...new Set([...grant[field], ...entries])]
                : grant[field].filter((name) => !entries.includes(name));
            runtime.db.set(guild, "grants", key, grant);
          });
        } else if (operation === "protect" || operation === "unprotect") {
          await validateSubject();
          const target = userId(id);
          const field = kind === "user" ? "protectedUsers" : "protectedRoles";
          const current = runtime.settings.get(guild)[field];
          runtime.settings.update(guild, {
            [field]:
              operation === "protect"
                ? [...new Set([...current, target])]
                : current.filter((x) => x !== target),
          });
        } else if (operation === "admin" || operation === "unadmin") {
          assert(ctx.user.id === ctx.guild.ownerId, "staff.ownerOnly");
          const target = userId(kind);
          await ctx.guild.members.fetch(target);
          const current = runtime.settings.get(guild).configAdmins;
          runtime.settings.update(guild, {
            configAdmins:
              operation === "admin"
                ? [...new Set([...current, target])]
                : current.filter((x) => x !== target),
          });
        } else if (operation === "limit") {
          const limit = integer(kind, 1, 100);
          runtime.settings.setModuleConfig(guild, "moderation", {
            ...runtime.settings.moduleConfig(guild, "moderation", {}),
            actionsPerMinute: limit,
          });
        } else {
          await ctx.reply(t(ctx.locale, "staff.usage"));
          return;
        }
        runtime.logger.info(
          { guild, actor: ctx.user.id, operation, kind, id },
          "Staff permissions changed",
        );
        await ctx.reply(t(ctx.locale, "staff.saved"));
      },
    });
  },
};
