import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} from "discord.js";
import type {
  Module,
  Runtime,
  ComponentInteraction,
} from "../../core/types.js";
import {
  registerTranslations,
  t,
  type Locale,
} from "../../core/localization.js";
import { assert, integer } from "../../shared.js";

const sections = [
  "moderation",
  "staff",
  "entertainment",
  "economy",
  "leveling",
  "social",
  "giveaways",
  "tickets",
  "welcome",
  "utilities",
  "statistics",
  "logging",
  "language",
  "health",
];
const labels: Record<string, [string, string]> = {
  moderation: ["Moderasyon", "Moderation"],
  staff: ["Personel yetkileri", "Staff permissions"],
  entertainment: ["Oyunlar", "Entertainment"],
  economy: ["Ekonomi", "Economy"],
  leveling: ["Seviye ve XP", "Leveling and XP"],
  social: ["Sosyal özellikler", "Social features"],
  giveaways: ["Çekilişler", "Giveaways"],
  tickets: ["Destek talepleri", "Tickets"],
  welcome: ["Karşılama", "Welcome"],
  utilities: ["Topluluk araçları", "Community tools"],
  statistics: ["İstatistikler", "Statistics"],
  logging: ["Kayıt kanalı", "Logging"],
  language: ["Dil", "Language"],
  health: ["Sistem durumu", "System health"],
};
registerTranslations({
  "panel.title": {
    tr: "Ultimate Executive • Yönetim",
    en: "Ultimate Executive • Management",
  },
  "panel.description": {
    tr: "Bir bölüm seçin. Değişiklikler yalnız bu sunucuya uygulanır.\nDurum: {state}\n{detail}",
    en: "Choose a section. Changes apply only to this server.\nStatus: {state}\n{detail}",
  },
  "panel.on": { tr: "Açık", en: "Enabled" },
  "panel.off": { tr: "Kapalı", en: "Disabled" },
  "panel.toggle": { tr: "Aç / Kapat", en: "Enable / Disable" },
  "panel.edit": { tr: "Ayarları düzenle", en: "Edit settings" },
  "panel.section": { tr: "Bölüm seçin", en: "Choose a section" },
  "panel.value": { tr: "Yeni değer", en: "New value" },
  "panel.staffHelp": {
    tr: ".staff help ile rol, kullanıcı ve komut gruplarını yönetin. Yapılandırma yöneticisi seçimi tüm sunucu ayarlarına erişim verir.",
    en: "Use .staff help to manage role, user, and command groups. Delegated configuration managers can change all guild settings.",
  },
  "panel.help": {
    tr: "Aşağıdaki seçimler anında kaydedilir. Ayrıntılı komutlar: .help",
    en: "Selections below are saved immediately. Detailed commands: .help",
  },
  "panel.notSet": { tr: "Ayarlanmadı", en: "Not configured" },
  "panel.channelLabel": { tr: "Kanal", en: "Channel" },
  "panel.roleLabel": { tr: "Rol", en: "Role" },
  "panel.managers": {
    tr: "Yapılandırma yöneticileri",
    en: "Configuration managers",
  },
  "panel.health": {
    tr: "Çalışma süresi: {seconds} sn • Bellek: {memory} MB • Bekleyen görev: {jobs}",
    en: "Uptime: {seconds}s • Memory: {memory} MB • Pending jobs: {jobs}",
  },
  ...Object.fromEntries(
    Object.entries(labels).map(([key, [tr, en]]) => [
      `panel.${key}`,
      { tr, en },
    ]),
  ),
});
interface Field {
  key: string;
  tr: string;
  en: string;
  min: number;
  max: number;
  fallback: number;
  scale?: number;
}
const fields: Record<string, Field[]> = {
  economy: [
    {
      key: "daily",
      tr: "Günlük ödül",
      en: "Daily reward",
      min: 0,
      max: 1000000,
      fallback: 200,
    },
    {
      key: "weekly",
      tr: "Haftalık ödül",
      en: "Weekly reward",
      min: 0,
      max: 10000000,
      fallback: 1500,
    },
    {
      key: "work",
      tr: "Çalışma ödülü",
      en: "Work reward",
      min: 0,
      max: 1000000,
      fallback: 75,
    },
  ],
  leveling: [
    {
      key: "messageXp",
      tr: "Mesaj başına XP",
      en: "Message XP",
      min: 0,
      max: 1000,
      fallback: 15,
    },
    {
      key: "messageCooldown",
      tr: "Mesaj XP bekleme (saniye)",
      en: "Message cooldown (seconds)",
      min: 15,
      max: 3600,
      fallback: 60000,
      scale: 1000,
    },
    {
      key: "voiceXp",
      tr: "Ses etkinliği XP",
      en: "Voice XP",
      min: 0,
      max: 1000,
      fallback: 10,
    },
  ],
  social: [
    {
      key: "repCooldown",
      tr: "İtibar bekleme (saat)",
      en: "Reputation cooldown (hours)",
      min: 1,
      max: 168,
      fallback: 86400000,
      scale: 3600000,
    },
  ],
  entertainment: [
    {
      key: "currencyReward",
      tr: "Kazanana jeton",
      en: "Winner coins",
      min: 0,
      max: 100000,
      fallback: 10,
    },
    {
      key: "xpReward",
      tr: "Kazanana XP",
      en: "Winner XP",
      min: 0,
      max: 1000,
      fallback: 5,
    },
  ],
  giveaways: [
    {
      key: "maxEntries",
      tr: "En çok katılımcı",
      en: "Maximum entries",
      min: 2,
      max: 100000,
      fallback: 1000,
    },
  ],
  moderation: [
    {
      key: "actionsPerMinute",
      tr: "Dakikalık işlem sınırı",
      en: "Actions per minute",
      min: 1,
      max: 100,
      fallback: 10,
    },
  ],
};
function view(r: Runtime, guild: string, section: string) {
  const l = r.settings.get(guild).locale,
    enabled = r.settings.enabled(guild, section);
  const detail =
    section === "health"
      ? t(l, "panel.health", {
          seconds: Math.floor((Date.now() - r.startedAt) / 1000),
          memory: Math.round(process.memoryUsage().rss / 1048576),
          jobs: r.db.list(guild, "jobs").length,
        })
      : t(l, section === "staff" ? "panel.staffHelp" : "panel.help");
  const config = r.settings.moduleConfig<Record<string, unknown>>(
    guild,
    section,
    {},
  );
  let values =
    fields[section]
      ?.map(
        (f) =>
          `${f[l]}: ${Number(config[f.key] ?? f.fallback) / (f.scale ?? 1)}`,
      )
      .join("\n") ?? t(l, "panel.help");
  if (section === "language") values = l === "tr" ? "Türkçe" : "English";
  if (section === "logging")
    values = r.settings.get(guild).logChannel
      ? `<#${r.settings.get(guild).logChannel}>`
      : t(l, "panel.notSet");
  if (section === "welcome" || section === "tickets") {
    const channel = config[section === "welcome" ? "channel" : "logChannelId"];
    const role = config[section === "welcome" ? "autoRole" : "supportRole"];
    values = `${t(l, "panel.channelLabel")}: ${channel ? `<#${String(channel)}>` : t(l, "panel.notSet")}\n${t(l, "panel.roleLabel")}: ${role ? `<@&${String(role)}>` : t(l, "panel.notSet")}`;
  }
  if (section === "staff")
    values = `${t(l, "panel.managers")}: ${
      r.settings
        .get(guild)
        .configAdmins.map((id) => `<@${id}>`)
        .join(", ") || t(l, "panel.notSet")
    }`;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(t(l, "panel.title"))
    .setDescription(
      t(l, "panel.description", {
        state: t(l, enabled ? "panel.on" : "panel.off"),
        detail,
      }),
    )
    .addFields({ name: t(l, `panel.${section}`), value: values.slice(0, 1024) })
    .setFooter({ text: t(l, "branding") });
  const rows: (
    | ActionRowBuilder<StringSelectMenuBuilder>
    | ActionRowBuilder<ButtonBuilder>
    | ActionRowBuilder<RoleSelectMenuBuilder>
    | ActionRowBuilder<ChannelSelectMenuBuilder>
    | ActionRowBuilder<UserSelectMenuBuilder>
  )[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("panel:section")
        .setPlaceholder(t(l, "panel.section"))
        .addOptions(
          sections.map((s) => ({
            label: t(l, `panel.${s}`),
            value: s,
            default: s === section,
          })),
        ),
    ),
  ];
  if (section === "language")
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("panel:language")
          .addOptions(
            { label: "Türkçe", value: "tr", default: l === "tr" },
            { label: "English", value: "en", default: l === "en" },
          ),
      ),
    );
  else if (
    section === "logging" ||
    section === "welcome" ||
    section === "tickets"
  )
    rows.push(
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`panel:channel:${section}`)
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  else if (section === "staff")
    rows.push(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("panel:admins")
          .setMinValues(0)
          .setMaxValues(10),
      ),
    );
  if (section === "welcome")
    rows.push(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("panel:role:welcome")
          .setMinValues(0)
          .setMaxValues(1),
      ),
    );
  if (!["logging", "language", "health", "staff"].includes(section))
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`panel:toggle:${section}`)
          .setLabel(t(l, "panel.toggle"))
          .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        ...(fields[section]
          ? [
              new ButtonBuilder()
                .setCustomId(`panel:edit:${section}`)
                .setLabel(t(l, "panel.edit"))
                .setStyle(ButtonStyle.Primary),
            ]
          : []),
      ),
    );
  return {
    embeds: [embed],
    components: rows,
    allowedMentions: { parse: [] as [] },
  };
}
async function handle(i: ComponentInteraction, r: Runtime): Promise<void> {
  assert(i.guild && i.guildId);
  assert(
    i.user.id === i.guild.ownerId ||
      r.settings.get(i.guildId).configAdmins.includes(i.user.id),
    "error.permission",
  );
  const l = r.settings.get(i.guildId).locale;
  const [, action, section = "moderation"] = i.customId.split(":");
  assert(
    sections.includes(section) ||
      ["section", "admins", "language"].includes(action ?? ""),
  );
  if (!(i.isButton() && action === "edit")) {
    if (i.isMessageComponent() || (i.isModalSubmit() && i.isFromMessage()))
      await i.deferUpdate();
    else await i.deferReply({ flags: MessageFlags.Ephemeral });
  }
  if (i.isStringSelectMenu() && action === "section") {
    const s = i.values[0]!;
    assert(sections.includes(s));
    await i.editReply(view(r, i.guildId, s));
    return;
  }
  if (i.isStringSelectMenu() && action === "language") {
    const lang = i.values[0];
    assert(lang === "tr" || lang === "en");
    r.settings.update(i.guildId, { locale: lang });
    await i.editReply(view(r, i.guildId, "language"));
    return;
  }
  if (i.isUserSelectMenu() && action === "admins") {
    assert(i.user.id === i.guild.ownerId, "error.permission");
    r.settings.update(i.guildId, {
      configAdmins: i.values.filter((id) => id !== i.guild!.ownerId),
    });
    await i.editReply(view(r, i.guildId, "staff"));
    return;
  }
  if (i.isChannelSelectMenu() && action === "channel") {
    const channel = await i.guild.channels.fetch(i.values[0]!);
    assert(channel?.isTextBased());
    if (section === "logging")
      r.settings.update(i.guildId, { logChannel: channel.id });
    else {
      const config = r.settings.moduleConfig<Record<string, unknown>>(
        i.guildId,
        section,
        {},
      );
      config[section === "welcome" ? "channel" : "logChannelId"] = channel.id;
      r.settings.setModuleConfig(i.guildId, section, config);
    }
    await i.editReply(view(r, i.guildId, section));
    return;
  }
  if (i.isRoleSelectMenu() && action === "role") {
    const role = i.values[0] ? await i.guild.roles.fetch(i.values[0]) : null;
    if (role) {
      assert(
        !role.managed &&
          role.id !== i.guildId &&
          role.permissions.bitfield === 0n &&
          (await r.permissions.canAssignPublicRole(role)),
        "error.permission",
      );
      assert(
        i.guild.members.me &&
          i.guild.members.me.roles.highest.comparePositionTo(role) > 0,
        "error.permission",
      );
    }
    r.settings.setModuleConfig(i.guildId, "welcome", {
      ...r.settings.moduleConfig(i.guildId, "welcome", {}),
      autoRole: role?.id,
    });
    await i.editReply(view(r, i.guildId, "welcome"));
    return;
  }
  if (i.isButton() && action === "toggle") {
    const settings = r.settings.get(i.guildId);
    r.settings.update(i.guildId, {
      disabledModules: settings.disabledModules.includes(section)
        ? settings.disabledModules.filter((s) => s !== section)
        : [...settings.disabledModules, section],
    });
    await i.editReply(view(r, i.guildId, section));
    return;
  }
  if (i.isButton() && action === "edit") {
    const fs = fields[section];
    assert(fs);
    const config = r.settings.moduleConfig<Record<string, number>>(
      i.guildId,
      section,
      {},
    );
    const modal = new ModalBuilder()
      .setCustomId(`panel:save:${section}`)
      .setTitle(t(l, `panel.${section}`))
      .addComponents(
        fs.map((f) =>
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(f.key)
              .setLabel(f[l])
              .setStyle(TextInputStyle.Short)
              .setValue(
                String(Number(config[f.key] ?? f.fallback) / (f.scale ?? 1)),
              )
              .setMaxLength(12),
          ),
        ),
      );
    await i.showModal(modal);
    return;
  }
  if (i.isModalSubmit() && action === "save") {
    const fs = fields[section];
    assert(fs);
    const config = r.settings.moduleConfig<Record<string, unknown>>(
      i.guildId,
      section,
      {},
    );
    for (const f of fs)
      config[f.key] =
        integer(i.fields.getTextInputValue(f.key), f.min, f.max) *
        (f.scale ?? 1);
    r.settings.setModuleConfig(i.guildId, section, config);
    if (i.isFromMessage()) await i.editReply(view(r, i.guildId, section));
    else await i.editReply({ content: t(l, "common.ok") });
    return;
  }
  assert(false);
}
export const panelModule: Module = {
  name: "panel",
  register(r) {
    r.registry.register({
      name: "panel",
      module: "panel",
      description: "panel.title",
      usage: ".panel",
      permission: "config",
      cooldown: 2000,
      async execute(ctx) {
        await ctx.reply(view(r, ctx.guild.id, "moderation"));
      },
    });
    r.interactions.set("panel", { module: "panel", handle });
  },
};
export function panelLocale(r: Runtime, guild: string): Locale {
  return r.settings.get(guild).locale;
}
