import { EmbedBuilder } from "discord.js";
import type { Module } from "../../core/types.js";
import { t, registerTranslations } from "../../core/localization.js";
registerTranslations({
  "statistics.command": {
    tr: "Sunucunun mesaj ve ses etkinliği",
    en: "Guild message and voice activity",
  },
  "statistics.view": {
    tr: "Mesaj: {messages}\nSes oturumu: {voice}\nÜye: {members}\nKanal: {channels}\n\nEn etkin kanallar\n{top}",
    en: "Messages: {messages}\nVoice sessions: {voice}\nMembers: {members}\nChannels: {channels}\n\nMost active channels\n{top}",
  },
});
interface Activity {
  messages: number;
  voice: number;
  channels: Record<string, number>;
}
export const statisticsModule: Module = {
  name: "statistics",
  register(r) {
    const stats = (guild: string) =>
      r.db.get<Activity>(guild, "statistics", "activity") ?? {
        messages: 0,
        voice: 0,
        channels: {},
      };
    r.messageHooks.push({
      module: "statistics",
      async handle(m) {
        if (!m.guild) return;
        const s = stats(m.guild.id);
        s.messages++;
        s.channels[m.channel.id] = (s.channels[m.channel.id] ?? 0) + 1;
        r.db.set(m.guild.id, "statistics", "activity", s);
      },
    });
    r.voiceHooks.push({
      module: "statistics",
      async handle(oldState, newState) {
        if (
          !oldState.channelId &&
          newState.channelId &&
          !newState.member?.user.bot
        ) {
          const s = stats(newState.guild.id);
          s.voice++;
          r.db.set(newState.guild.id, "statistics", "activity", s);
        }
      },
    });
    r.registry.register({
      name: "stats",
      aliases: ["istatistik"],
      module: "statistics",
      description: "statistics.command",
      usage: ".stats",
      async execute(ctx) {
        const s = stats(ctx.guild.id);
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(t(ctx.locale, "statistics.command"))
              .setDescription(
                t(ctx.locale, "statistics.view", {
                  messages: s.messages,
                  voice: s.voice,
                  members: ctx.guild.memberCount,
                  channels: ctx.guild.channels.cache.size,
                  top:
                    Object.entries(s.channels)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 10)
                      .map(([id, count]) => `<#${id}>: ${count}`)
                      .join("\n") || "—",
                }),
              )
              .setFooter({ text: t(ctx.locale, "branding") }),
          ],
        });
      },
    });
  },
};
