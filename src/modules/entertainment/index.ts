import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from "discord.js";
import { randomInt } from "node:crypto";
import type {
  Module,
  Runtime,
  CommandContext,
  ComponentInteraction,
} from "../../core/types.js";
import { t } from "../../core/localization.js";
import { assert, integer, userId, UserError } from "../../shared.js";
import { GameEngine, type GameKind, type GameSession } from "./engine.js";
import { renderGame } from "./render.js";
import type { QuizCategory } from "./questions.js";
import { EconomyService } from "../economy/service.js";
import { LevelingService } from "../leveling/service.js";
import "./localization.js";

interface EntertainmentSettings {
  currencyReward: number;
  xpReward: number;
  sessionMs: number;
}
const defaults: EntertainmentSettings = {
  currencyReward: 10,
  xpReward: 5,
  sessionMs: 300000,
};
const sessionLocks = new Map<string, Promise<unknown>>();
async function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(fn);
  sessionLocks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (sessionLocks.get(key) === pending) sessionLocks.delete(key);
  }
}
const categories: Record<string, QuizCategory> = {
  general: "general",
  genel: "general",
  technology: "technology",
  teknoloji: "technology",
  gaming: "gaming",
  oyun: "gaming",
  science: "science",
  bilim: "science",
  geography: "geography",
  cografya: "geography",
  coğrafya: "geography",
  history: "history",
  tarih: "history",
};

function settings(runtime: Runtime, guild: string): EntertainmentSettings {
  const raw = runtime.settings.moduleConfig(guild, "entertainment", defaults);
  return {
    currencyReward:
      Number.isSafeInteger(raw.currencyReward) && raw.currencyReward >= 0
        ? Math.min(raw.currencyReward, 100000)
        : 10,
    xpReward:
      Number.isSafeInteger(raw.xpReward) && raw.xpReward >= 0
        ? Math.min(raw.xpReward, 10000)
        : 5,
    sessionMs:
      Number.isSafeInteger(raw.sessionMs) && raw.sessionMs >= 30000
        ? Math.min(raw.sessionMs, 3600000)
        : 300000,
  };
}
export function settleGameRewards(runtime: Runtime, s: GameSession): void {
  if (s.status !== "won" || !s.winner || s.winner === "bot") return;
  const config = settings(runtime, s.guild);
  runtime.db.transaction(() => {
    const latest = runtime.db.get<GameSession>(s.guild, "gameSessions", s.id);
    if (!latest || latest.rewarded) return;
    if (
      runtime.settings.enabled(s.guild, "economy") &&
      config.currencyReward > 0
    )
      new EconomyService(runtime.db, runtime.settings).credit(
        s.guild,
        s.winner!,
        config.currencyReward,
        `game:${s.id}:coins`,
      );
    if (runtime.settings.enabled(s.guild, "leveling") && config.xpReward > 0)
      new LevelingService(runtime.db, runtime.settings).award(
        s.guild,
        s.winner!,
        config.xpReward,
        `game:${s.id}:xp`,
      );
    latest.rewarded = true;
    runtime.db.set(s.guild, "gameSessions", s.id, latest);
  });
}
async function publish(runtime: Runtime, s: GameSession): Promise<void> {
  if (!s.message) return;
  const channel = await runtime.client.channels.fetch(s.channel);
  if (channel?.isTextBased() && "messages" in channel)
    await channel.messages.edit(s.message, renderGame(s));
}
async function startGame(ctx: CommandContext, kind: GameKind): Promise<void> {
  const { runtime } = ctx;
  const engine = new GameEngine(runtime.db);
  const players = [ctx.user.id];
  if (
    ["xox", "connect4", "duello"].includes(kind) ||
    (kind === "tkm" && ctx.args[0])
  ) {
    const id = userId(ctx.args[0]);
    const target = await ctx.guild.members.fetch(id);
    assert(!target.user.bot && target.id !== ctx.user.id);
    players.push(target.id);
  } else if (kind === "tkm") players.push("bot");
  let category: QuizCategory | undefined;
  if (kind === "quiz" && ctx.args[0]) {
    category = categories[ctx.args[0].toLocaleLowerCase("tr")];
    assert(category);
  }
  assert(ctx.channel.isSendable());
  const s = engine.create({
    guild: ctx.guild.id,
    channel: ctx.channel.id,
    kind,
    players,
    locale: ctx.locale,
    category,
    duration: settings(runtime, ctx.guild.id).sessionMs,
  });
  runtime.scheduler.schedule(
    s.guild,
    "entertainment",
    "game.expire",
    s.expires,
    { id: s.id },
    `game.expire:${s.id}`,
  );
  try {
    const message = await ctx.channel.send(renderGame(s));
    engine.bind(s.guild, s.id, message.id);
  } catch (error) {
    runtime.db.delete(s.guild, "gameSessions", s.id);
    runtime.scheduler.cancel(s.guild, `game.expire:${s.id}`);
    throw error;
  }
  if (!ctx.message) await ctx.reply(t(ctx.locale, "common.ok"));
}
async function interaction(
  i: ComponentInteraction,
  runtime: Runtime,
): Promise<void> {
  assert(i.guildId);
  const [, id, versionText, action, value] = i.customId.split(":");
  assert(id && versionText && action);
  const engine = new GameEngine(runtime.db);
  const s = engine.get(i.guildId, id);
  assert(s, "error.expired");
  assert(s.channel === i.channelId, "error.permission");
  if (i.isMessageComponent())
    assert(!s.message || i.message.id === s.message, "error.permission");
  const version = integer(versionText, 0, Number.MAX_SAFE_INTEGER);
  if (action === "open") {
    assert(i.isButton());
    assert(s.players.includes(i.user.id), "error.permission");
    assert(s.status === "active" && s.expires > Date.now(), "error.expired");
    assert(s.version === version, "game.stale");
    const input = new TextInputBuilder()
      .setCustomId("answer")
      .setLabel(t(s.locale, "game.guessLabel"))
      .setPlaceholder(t(s.locale, "game.guessPlaceholder"))
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(100)
      .setStyle(TextInputStyle.Short);
    const modal = new ModalBuilder()
      .setCustomId(`game:${s.id}:${s.version}:guess:`)
      .setTitle(t(s.locale, `game.title.${s.kind}`))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input),
      );
    await i.showModal(modal);
    return;
  }
  assert(i.isButton() || i.isModalSubmit());
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await serialize(`${i.guildId}:${id}`, async () => {
    let updated: GameSession;
    try {
      updated = engine.act(i.guildId!, id, {
        user: i.user.id,
        version,
        action,
        value: i.isModalSubmit() ? i.fields.getTextInputValue("answer") : value,
      });
    } catch (error) {
      if (error instanceof UserError && error.key === "game.stale") {
        const latest = engine.get(i.guildId!, id);
        if (latest) await publish(runtime, latest);
      }
      throw error;
    }
    // The expiration job also recovers rewards if the process exits immediately after this transition.
    if (updated.status === "won") {
      try {
        settleGameRewards(runtime, updated);
      } catch (error) {
        runtime.logger.error(
          { err: error, game: id },
          "Game reward pending; expiration job will retry",
        );
      }
    }
    await publish(runtime, updated);
    await i.editReply(t(updated.locale, "common.ok"));
  });
}
export const entertainmentModule: Module = {
  name: "entertainment",
  register(runtime) {
    const games: {
      name: string;
      kind: GameKind;
      aliases?: string[];
      usage: string;
    }[] = [
      { name: "tkm", kind: "tkm", aliases: ["rps"], usage: ".tkm [@user]" },
      { name: "xox", kind: "xox", aliases: ["tictactoe"], usage: ".xox @user" },
      { name: "connect4", kind: "connect4", usage: ".connect4 @user" },
      {
        name: "quiz",
        kind: "quiz",
        usage: ".quiz [general|technology|gaming|science|geography|history]",
      },
      { name: "kelime", kind: "kelime", aliases: ["word"], usage: ".kelime" },
      {
        name: "adamasmaca",
        kind: "adamasmaca",
        aliases: ["hangman"],
        usage: ".adamasmaca",
      },
      {
        name: "duello",
        kind: "duello",
        aliases: ["duel"],
        usage: ".duello @user",
      },
      {
        name: "sayi",
        kind: "sayi",
        aliases: ["tahmin", "number"],
        usage: ".sayi",
      },
      { name: "emoji", kind: "emoji", usage: ".emoji" },
    ];
    for (const game of games)
      runtime.registry.register({
        name: game.name,
        aliases: game.aliases,
        module: "entertainment",
        description: `game.desc.${game.name}`,
        usage: game.usage,
        cooldown: 5000,
        execute: (ctx) => startGame(ctx, game.kind),
      });
    runtime.registry.register({
      name: "yazitura",
      aliases: ["coinflip"],
      module: "entertainment",
      description: "game.desc.yazitura",
      usage: ".yazitura",
      cooldown: 3000,
      async execute(ctx) {
        await ctx.reply(
          t(ctx.locale, "game.flip", {
            result: t(ctx.locale, randomInt(2) ? "game.heads" : "game.tails"),
          }),
        );
      },
    });
    runtime.registry.register({
      name: "zar",
      aliases: ["dice"],
      module: "entertainment",
      description: "game.desc.zar",
      usage: ".zar [count:1-5] [sides:2-1000]",
      cooldown: 3000,
      async execute(ctx) {
        const count = ctx.args[0] ? integer(ctx.args[0], 1, 5) : 1,
          sides = ctx.args[1] ? integer(ctx.args[1], 2, 1000) : 6;
        await ctx.reply(
          t(ctx.locale, "game.dice", {
            sides,
            result: Array.from({ length: count }, () =>
              randomInt(1, sides + 1),
            ).join(", "),
          }),
        );
      },
    });
    runtime.registry.register({
      name: "8ball",
      module: "entertainment",
      description: "game.desc.8ball",
      usage: ".8ball question",
      cooldown: 3000,
      async execute(ctx) {
        assert(ctx.args.join(" ").trim().length > 0);
        await ctx.reply(t(ctx.locale, `game.ball${randomInt(6)}`));
      },
    });
    runtime.interactions.set("game", {
      module: "entertainment",
      handle: interaction,
    });
    runtime.scheduler.register("game.expire", async (job) => {
      const { id } = job.payload as { id: string };
      await serialize(`${job.guild}:${id}`, async () => {
        const s = new GameEngine(runtime.db).expire(job.guild, id);
        if (!s) return;
        let rewardError: unknown;
        if (s.status === "won") {
          try {
            settleGameRewards(runtime, s);
          } catch (error) {
            rewardError = error;
          }
        }
        try {
          await publish(runtime, s);
        } catch (error) {
          const code = (error as { code?: number }).code;
          if (
            code !== 10003 &&
            code !== 10008 &&
            code !== 50001 &&
            code !== 50013
          )
            throw error;
          runtime.logger.warn(
            { game: id, code },
            "Game message is no longer editable",
          );
        }
        if (rewardError) throw rewardError;
      });
    });
  },
};
