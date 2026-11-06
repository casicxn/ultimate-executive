import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageCreateOptions,
} from "discord.js";
import type { Locale } from "../../core/localization.js";
import { t } from "../../core/localization.js";
import { safeText } from "../../shared.js";
import type { CommunityEvent, Giveaway, Poll } from "./service.js";
import "./localization.js";
type View = Pick<
  MessageCreateOptions,
  "embeds" | "components" | "allowedMentions"
>;
const row = (...buttons: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
const button = (
  customId: string,
  label: string,
  disabled = false,
  style = ButtonStyle.Primary,
) =>
  new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setDisabled(disabled)
    .setStyle(style);
export function renderGiveaway(s: Giveaway, locale: Locale): View {
  const ended = s.status === "ended";
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x42d392 : 0x9b59b6)
    .setTitle(t(locale, "giveaway.title", { prize: safeText(s.prize, 200) }))
    .setDescription(
      t(locale, "giveaway.body", {
        organizer: s.organizer,
        ends: Math.floor(s.ends / 1000),
        count: s.winnerCount,
        entries: s.entrants.length,
      }),
    )
    .setFooter({ text: `${s.id} • ${t(locale, "branding")}` });
  embed.addFields({
    name: t(locale, "giveaway.requirements"),
    value: t(locale, "giveaway.requirementsText", {
      role: s.eligibility.roleId
        ? `<@&${s.eligibility.roleId}>`
        : t(locale, "giveaway.noRole"),
      days: s.eligibility.minAccountDays,
      level: s.eligibility.minLevel,
    }),
  });
  for (const [i, r] of s.rounds.slice(-5).entries())
    embed.addFields({
      name: t(locale, "giveaway.results", {
        round: Math.max(0, s.rounds.length - 5) + i + 1,
      }),
      value: r.winners.length
        ? r.winners.map((w) => `<@${w}>`).join(", ")
        : t(locale, "giveaway.none"),
    });
  return {
    embeds: [embed],
    components: [
      row(
        button(
          `community:giveaway:${s.id}:join`,
          t(locale, "community.join"),
          ended,
        ),
        button(
          `community:giveaway:${s.id}:leave`,
          t(locale, "community.leave"),
          ended,
          ButtonStyle.Secondary,
        ),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}
export function renderPoll(s: Poll, locale: Locale): View {
  const ended = s.status === "ended",
    total = Object.keys(s.votes).length;
  const counts = s.options.map(
    (_, i) => Object.values(s.votes).filter((v) => v === i).length,
  );
  const results = s.options
    .map(
      (option, i) =>
        `${i + 1}. **${safeText(option, 80)}** — ${counts[i]} (${total ? Math.round((counts[i]! / total) * 100) : 0}%)`,
    )
    .join("\n");
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(t(locale, "poll.title", { question: safeText(s.question, 200) }))
    .setDescription(
      `${t(locale, "poll.body", { ends: Math.floor(s.ends / 1000), votes: total, change: t(locale, s.changeVotes ? "poll.allowed" : "poll.fixed"), results })}${ended ? `\n\n${t(locale, "poll.ended")}` : ""}`,
    )
    .setFooter({ text: `${s.id} • ${t(locale, "branding")}` });
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let start = 0; start < s.options.length; start += 5)
    components.push(
      row(
        ...s.options
          .slice(start, start + 5)
          .map((_, i) =>
            button(
              `community:poll:${s.id}:${start + i}`,
              String(start + i + 1),
              ended,
            ),
          ),
      ),
    );
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
export function renderEvent(s: CommunityEvent, locale: Locale): View {
  const inactive = s.status !== "scheduled";
  const embed = new EmbedBuilder()
    .setColor(s.status === "cancelled" ? 0xe74c3c : 0xf1c40f)
    .setTitle(t(locale, "event.title", { title: safeText(s.title, 200) }))
    .setDescription(
      `${t(locale, "event.body", { organizer: s.organizer, starts: Math.floor(s.starts / 1000), count: s.attendees.length, description: safeText(s.description, 1500) })}${s.status === "cancelled" ? `\n\n${t(locale, "event.cancelled")}` : s.status === "started" ? `\n\n${t(locale, "event.started")}` : s.reminded ? `\n\n${t(locale, "event.reminder")}` : ""}`,
    )
    .setFooter({ text: `${s.id} • ${t(locale, "branding")}` });
  return {
    embeds: [embed],
    components: [
      row(
        button(
          `community:event:${s.id}:join`,
          t(locale, "community.join"),
          inactive,
        ),
        button(
          `community:event:${s.id}:leave`,
          t(locale, "community.leave"),
          inactive,
          ButtonStyle.Secondary,
        ),
        button(
          `community:event:${s.id}:cancel`,
          t(locale, "event.cancel"),
          inactive,
          ButtonStyle.Danger,
        ),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}
