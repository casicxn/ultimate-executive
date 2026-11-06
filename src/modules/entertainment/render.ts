import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { t } from "../../core/localization.js";
import { safeText } from "../../shared.js";
import type { GameSession } from "./engine.js";
import { emojiQuestions, questions } from "./questions.js";
import "./localization.js";

const rpsNames = ["game.rock", "game.paper", "game.scissors"];
export function renderGame(
  s: GameSession,
): Pick<MessageCreateOptions, "embeds" | "components" | "allowedMentions"> {
  const locale = s.locale,
    active = s.status === "active",
    ended = !["active", "pending"].includes(s.status);
  const player = (id: string) => (id === "bot" ? "🤖" : `<@${id}>`);
  const custom = (action: string, value = "") =>
    `game:${s.id}:${s.version}:${action}:${value}`;
  const button = (
    label: string,
    action: string,
    value = "",
    disabled = false,
    style: ButtonStyle = ButtonStyle.Primary,
  ) =>
    new ButtonBuilder()
      .setCustomId(custom(action, value))
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let description = "";
  if (s.status === "pending") {
    description = t(locale, "game.challenge", {
      player: player(s.players[1]!),
    });
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(t(locale, "common.accept"), "accept"),
        button(
          t(locale, "common.reject"),
          "reject",
          "",
          false,
          ButtonStyle.Secondary,
        ),
      ),
    );
  } else {
    if (s.kind === "xox") {
      description = t(locale, "game.turnText", {
        player: player(s.players[s.turn]!),
      });
      for (let y = 0; y < 3; y++)
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...Array.from({ length: 3 }, (_, x) => {
              const cell = y * 3 + x,
                mark = s.board[cell];
              return button(
                mark === 1 ? "❌" : mark === 2 ? "⭕" : "·",
                "move",
                String(cell),
                !active || mark !== 0,
                mark ? ButtonStyle.Secondary : ButtonStyle.Primary,
              );
            }),
          ),
        );
    }
    if (s.kind === "connect4") {
      description = `${t(locale, "game.turnText", { player: player(s.players[s.turn]!) })}\n${Array.from(
        { length: 6 },
        (_, y) =>
          s.board
            .slice(y * 7, y * 7 + 7)
            .map((v) => (v === 1 ? "🔴" : v === 2 ? "🟡" : "⚫"))
            .join(""),
      ).join("\n")}\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣`;
      for (const start of [0, 4])
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...Array.from({ length: start === 0 ? 4 : 3 }, (_, i) =>
              button(
                String(start + i + 1),
                "move",
                String(start + i),
                !active || s.board[start + i] !== 0,
              ),
            ),
          ),
        );
    }
    if (s.kind === "tkm") {
      if (!ended)
        description = t(locale, "game.selectedText", {
          count: Object.keys(s.choices).length,
          total: s.players.length,
        });
      else
        description = t(locale, "game.rpsResult", {
          choices: s.players
            .map(
              (p) =>
                `${player(p)}: ${s.choices[p] === undefined ? "—" : t(locale, rpsNames[s.choices[p]!]!)}`,
            )
            .join(" • "),
        });
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...rpsNames.map((key, i) =>
            button(t(locale, key), "pick", String(i), !active),
          ),
        ),
      );
    }
    if (s.kind === "quiz" || s.kind === "emoji") {
      const q =
        s.kind === "quiz"
          ? questions.find((q) => q.id === s.questionId)!
          : emojiQuestions[s.questionIndex!]!;
      description = `${s.kind === "emoji" ? `${emojiQuestions[s.questionIndex!]!.emoji}\n` : ""}${q.text[locale]}\n${q.options[locale].map((text, index) => `${index + 1}. ${text}`).join("\n")}`;
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...q.options[locale].map((_, i) =>
            button(String(i + 1), "pick", String(i), !active),
          ),
        ),
      );
    }
    if (s.kind === "duello") {
      description = `${t(locale, "game.turnText", { player: player(s.players[s.turn]!) })}\n${t(locale, "game.health", { health: s.players.map((p, i) => `${player(p)}: ${s.health[i]}/12`).join(" • ") })}`;
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button(t(locale, "game.attack"), "attack", "", !active),
        ),
      );
    }
    if (["kelime", "adamasmaca", "sayi", "tahmin"].includes(s.kind)) {
      if (s.kind === "kelime")
        description = t(locale, "game.scramble", {
          letters: [...s.answer!].reverse().join(" "),
        });
      else if (s.kind === "adamasmaca")
        description = t(locale, "game.hangmanText", {
          mask: [...s.answer!]
            .map((letter) =>
              s.guesses.includes(letter) || ended ? letter : "＿",
            )
            .join(" "),
          guesses: safeText(s.guesses.join(", ")) || "—",
        });
      else description = t(locale, "game.numberText");
      if (s.clue) description += `\n${t(locale, `game.${s.clue}`)}`;
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button(t(locale, "game.guess"), "open", "", !active),
        ),
      );
    }
    if (ended) {
      if (s.status === "won")
        description += `\n\n🏆 ${t(locale, "game.won", { player: player(s.winner!) })}`;
      else if (s.status === "lost") {
        const answer = s.answer ?? String(s.secret ?? "");
        const q =
          s.kind === "quiz"
            ? questions.find((q) => q.id === s.questionId)
            : s.kind === "emoji"
              ? emojiQuestions[s.questionIndex!]
              : undefined;
        description += `\n\n${t(locale, "game.lost", { answer: q ? q.options[locale][q.answer]! : answer })}`;
      } else description += `\n\n${t(locale, `game.${s.status}`)}`;
    }
  }
  if (active)
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          t(locale, "common.cancel"),
          "quit",
          "",
          false,
          ButtonStyle.Secondary,
        ),
      ),
    );
  const embed = new EmbedBuilder()
    .setColor(s.status === "won" ? 0x42d392 : 0x5865f2)
    .setTitle(t(locale, `game.title.${s.kind}`))
    .setDescription(description)
    .setFooter({ text: t(locale, "branding") });
  if (!ended)
    embed.addFields({
      name: "⌛",
      value: t(locale, "game.deadline", {
        time: Math.floor(s.expires / 1000),
        moves: s.moves,
      }),
    });
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
