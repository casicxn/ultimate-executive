import { PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import type {
  Module,
  Runtime,
  CommandContext,
  ComponentInteraction,
} from "../../core/types.js";
import { t } from "../../core/localization.js";
import { assert, duration, integer, safeText, userId } from "../../shared.js";
import {
  GiveawayService,
  PollService,
  EventService,
  qualifies,
  type Giveaway,
  type Eligibility,
  type Poll,
  type CommunityEvent,
} from "./service.js";
import { renderGiveaway, renderPoll, renderEvent } from "./render.js";
import { LevelingService, levelFor } from "../leveling/service.js";
import "./localization.js";

const locks = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(fn);
  locks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (locks.get(key) === pending) locks.delete(key);
  }
}
type CommunityRecord = Giveaway | Poll | CommunityEvent;
async function edit(
  runtime: Runtime,
  s: CommunityRecord,
  kind: "giveaway" | "poll" | "event",
): Promise<void> {
  if (!s.message) return;
  const channel = await runtime.client.channels.fetch(s.channel);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const locale = runtime.settings.get(s.guild).locale;
  const view =
    kind === "giveaway"
      ? renderGiveaway(s as Giveaway, locale)
      : kind === "poll"
        ? renderPoll(s as Poll, locale)
        : renderEvent(s as CommunityEvent, locale);
  await channel.messages.edit(s.message, view);
}
async function safeEdit(
  runtime: Runtime,
  s: CommunityRecord,
  kind: "giveaway" | "poll" | "event",
): Promise<void> {
  try {
    await edit(runtime, s, kind);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 10003 && code !== 10008 && code !== 50001 && code !== 50013)
      throw error;
    runtime.logger.warn(
      { id: s.id, code },
      "Community message no longer editable",
    );
  }
}
async function eligible(
  runtime: Runtime,
  guildId: string,
  user: string,
  rules: Eligibility,
): Promise<boolean> {
  const guild = await runtime.client.guilds.fetch(guildId);
  try {
    const member = await guild.members.fetch(user);
    const xp = new LevelingService(runtime.db, runtime.settings).profile(
      guildId,
      user,
    ).xp;
    return qualifies(rules, {
      bot: member.user.bot,
      joinedGuild: true,
      roles: member.roles.cache.map((r) => r.id),
      created: member.user.createdTimestamp,
      level: levelFor(xp),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 10007) return false;
    throw error;
  }
}
async function eligibleEntrants(
  runtime: Runtime,
  s: Giveaway,
): Promise<string[]> {
  const result: string[] = [];
  for (const user of s.entrants)
    if (await eligible(runtime, s.guild, user, s.eligibility))
      result.push(user);
  return result;
}
async function createGiveaway(ctx: CommandContext): Promise<void> {
  const [time, count, ...rest] = ctx.args;
  const options = rest.filter((a) => /^(role|minlevel|accountdays)=/.test(a));
  const prize = rest
    .filter((a) => !/^(role|minlevel|accountdays)=/.test(a))
    .join(" ");
  const rules: Eligibility = { minAccountDays: 0, minLevel: 0 };
  for (const option of options) {
    const [key, value] = option.split("=");
    if (key === "role") rules.roleId = userId(value);
    if (key === "minlevel") rules.minLevel = integer(value, 0, 10000);
    if (key === "accountdays") rules.minAccountDays = integer(value, 0, 3650);
  }
  if (rules.roleId) assert(await ctx.guild.roles.fetch(rules.roleId));
  assert(ctx.channel.isSendable());
  const service = new GiveawayService(ctx.runtime.db);
  const s = service.create({
    guild: ctx.guild.id,
    channel: ctx.channel.id,
    organizer: ctx.user.id,
    prize,
    ends: Date.now() + duration(time, 30 * 86400000),
    winnerCount: integer(count, 1, 20),
    eligibility: rules,
  });
  ctx.runtime.scheduler.schedule(
    s.guild,
    "giveaways",
    "giveaway.end",
    s.ends,
    { id: s.id },
    `giveaway:${s.id}`,
  );
  try {
    const message = await ctx.channel.send(renderGiveaway(s, ctx.locale));
    service.bind(s.guild, s.id, message.id);
  } catch (error) {
    ctx.runtime.db.delete(s.guild, "giveaways", s.id);
    ctx.runtime.scheduler.cancel(s.guild, `giveaway:${s.id}`);
    throw error;
  }
  if (!ctx.message) await ctx.reply(t(ctx.locale, "common.ok"));
}
async function createPoll(ctx: CommandContext): Promise<void> {
  const [time, ...rest] = ctx.args;
  const [question, ...options] = rest
    .join(" ")
    .split("|")
    .map((s) => s.trim());
  assert(question && ctx.channel.isSendable());
  const cfg = ctx.runtime.settings.moduleConfig(ctx.guild.id, "giveaways", {
    changeVotes: true,
  });
  const service = new PollService(ctx.runtime.db);
  const s = service.create({
    guild: ctx.guild.id,
    channel: ctx.channel.id,
    organizer: ctx.user.id,
    question,
    options,
    ends: Date.now() + duration(time, 30 * 86400000),
    changeVotes: cfg.changeVotes !== false,
  });
  ctx.runtime.scheduler.schedule(
    s.guild,
    "giveaways",
    "poll.end",
    s.ends,
    { id: s.id },
    `poll:${s.id}`,
  );
  try {
    const message = await ctx.channel.send(renderPoll(s, ctx.locale));
    service.bind(s.guild, s.id, message.id);
  } catch (error) {
    ctx.runtime.db.delete(s.guild, "polls", s.id);
    ctx.runtime.scheduler.cancel(s.guild, `poll:${s.id}`);
    throw error;
  }
  if (!ctx.message) await ctx.reply(t(ctx.locale, "common.ok"));
}
async function createEvent(ctx: CommandContext): Promise<void> {
  if (ctx.args[0] === "cancel" || ctx.args[0] === "iptal") {
    const id = ctx.args[1];
    assert(id);
    const service = new EventService(ctx.runtime.db);
    await locked(`${ctx.guild.id}:${id}`, async () => {
      const s = service.cancel(ctx.guild.id, id);
      ctx.runtime.scheduler.cancel(s.guild, `event.remind:${id}`);
      ctx.runtime.scheduler.cancel(s.guild, `event.start:${id}`);
      await safeEdit(ctx.runtime, s, "event");
    });
    await ctx.reply(t(ctx.locale, "event.cancelled"));
    return;
  }
  const [time, ...rest] = ctx.args;
  const [title, ...descriptions] = rest
    .join(" ")
    .split("|")
    .map((s) => s.trim());
  assert(title && ctx.channel.isSendable());
  const service = new EventService(ctx.runtime.db);
  const s = service.create({
    guild: ctx.guild.id,
    channel: ctx.channel.id,
    organizer: ctx.user.id,
    title,
    description: descriptions.join("\n"),
    starts: Date.now() + duration(time, 365 * 86400000),
  });
  ctx.runtime.scheduler.schedule(
    s.guild,
    "giveaways",
    "event.remind",
    Math.max(Date.now(), s.starts - 600000),
    { id: s.id },
    `event.remind:${s.id}`,
  );
  ctx.runtime.scheduler.schedule(
    s.guild,
    "giveaways",
    "event.start",
    s.starts,
    { id: s.id },
    `event.start:${s.id}`,
  );
  try {
    const message = await ctx.channel.send(renderEvent(s, ctx.locale));
    service.bind(s.guild, s.id, message.id);
  } catch (error) {
    ctx.runtime.db.delete(s.guild, "events", s.id);
    ctx.runtime.scheduler.cancel(s.guild, `event.remind:${s.id}`);
    ctx.runtime.scheduler.cancel(s.guild, `event.start:${s.id}`);
    throw error;
  }
  if (!ctx.message) await ctx.reply(t(ctx.locale, "common.ok"));
}
async function component(
  i: ComponentInteraction,
  runtime: Runtime,
): Promise<void> {
  assert(i.isButton() && i.guildId && i.guild);
  assert(!i.user.bot, "error.permission");
  const [, kind, id, action] = i.customId.split(":");
  assert(id && action);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await locked(`${i.guildId}:${id}`, async () => {
    let result: CommunityRecord;
    let messageKey = "community.joined";
    if (kind === "giveaway") {
      const service = new GiveawayService(runtime.db);
      const s = service.get(i.guildId!, id);
      assert(
        s.channel === i.channelId && s.message === i.message.id,
        "error.permission",
      );
      assert(action === "join" || action === "leave");
      const maxEntries =
        runtime.settings.moduleConfig(i.guildId!, "giveaways", {
          maxEntries: 1000,
        }).maxEntries ?? 1000;
      result =
        action === "join"
          ? service.join(
              i.guildId!,
              id,
              i.user.id,
              await eligible(runtime, i.guildId!, i.user.id, s.eligibility),
              maxEntries,
            )
          : service.leave(i.guildId!, id, i.user.id);
      if (action === "leave") messageKey = "community.left";
    } else if (kind === "poll") {
      const service = new PollService(runtime.db);
      const s = service.get(i.guildId!, id);
      assert(
        s.channel === i.channelId && s.message === i.message.id,
        "error.permission",
      );
      await i.guild!.members.fetch(i.user.id);
      result = service.vote(i.guildId!, id, i.user.id, integer(action, 0, 9));
      messageKey = "community.voted";
    } else {
      assert(kind === "event");
      const service = new EventService(runtime.db);
      const s = service.get(i.guildId!, id);
      assert(
        s.channel === i.channelId && s.message === i.message.id,
        "error.permission",
      );
      const member = await i.guild!.members.fetch(i.user.id);
      if (action === "cancel") {
        assert(
          i.user.id === s.organizer ||
            runtime.permissions.can(
              member,
              "events.manage",
              PermissionFlagsBits.ManageEvents,
            ),
          "error.permission",
        );
        result = service.cancel(i.guildId!, id);
        runtime.scheduler.cancel(s.guild, `event.remind:${id}`);
        runtime.scheduler.cancel(s.guild, `event.start:${id}`);
        messageKey = "event.cancelled";
      } else {
        assert(action === "join" || action === "leave");
        result = service.rsvp(i.guildId!, id, i.user.id, action === "join");
        if (action === "leave") messageKey = "community.left";
      }
    }
    await safeEdit(runtime, result, kind as "giveaway" | "poll" | "event");
    await i.editReply(t(runtime.settings.get(i.guildId!).locale, messageKey));
  });
}
export const giveawaysModule: Module = {
  name: "giveaways",
  register(runtime) {
    runtime.registry.register({
      name: "giveaway",
      aliases: ["cekilis", "çekiliş"],
      module: "giveaways",
      description: "giveaway.desc",
      usage: ".giveaway 1h 2 prize [role=ID] [minlevel=5] [accountdays=7]",
      permission: "giveaways.manage",
      nativePermission: PermissionFlagsBits.ManageGuild,
      cooldown: 10000,
      execute: createGiveaway,
    });
    runtime.registry.register({
      name: "reroll",
      module: "giveaways",
      description: "giveaway.rerollDesc",
      usage: ".reroll giveaway-id",
      permission: "giveaways.manage",
      nativePermission: PermissionFlagsBits.ManageGuild,
      cooldown: 10000,
      async execute(ctx) {
        const id = ctx.args[0];
        assert(id);
        await locked(`${ctx.guild.id}:${id}`, async () => {
          const key = `reroll:${ctx.requestId}`;
          const service = new GiveawayService(runtime.db);
          const s = service.get(ctx.guild.id, id);
          assert(s.status === "ended");
          if (!runtime.db.get(s.guild, "communityOperations", key)) {
            const entries = await eligibleEntrants(runtime, s);
            runtime.db.transaction(() => {
              service.finish(s.guild, s.id, entries, true);
              runtime.db.set(s.guild, "communityOperations", key, {
                id,
                at: Date.now(),
              });
            });
          }
          await safeEdit(runtime, service.get(s.guild, id), "giveaway");
        });
        await ctx.reply(t(ctx.locale, "common.ok"));
      },
    });
    runtime.registry.register({
      name: "giveawayhistory",
      aliases: ["cekilisgecmisi"],
      module: "giveaways",
      description: "giveaway.historyDesc",
      usage: ".giveawayhistory",
      async execute(ctx) {
        const rows = runtime.db
          .list<Giveaway>(ctx.guild.id, "giveaways")
          .map((r) => r.value)
          .sort((a, b) => b.ends - a.ends)
          .slice(0, 15);
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(t(ctx.locale, "giveaway.history"))
          .setDescription(
            rows
              .map(
                (s) =>
                  `\`${s.id}\` • ${safeText(s.prize, 100)} • ${
                    s.rounds
                      .at(-1)
                      ?.winners.map((w) => `<@${w}>`)
                      .join(", ") || "—"
                  }`,
              )
              .join("\n") || "—",
          );
        await ctx.reply({ embeds: [embed] });
      },
    });
    runtime.registry.register({
      name: "anket",
      aliases: ["poll"],
      module: "giveaways",
      description: "poll.desc",
      usage: ".anket 10m Question | Option A | Option B",
      permission: "polls.manage",
      nativePermission: PermissionFlagsBits.ManageMessages,
      cooldown: 10000,
      execute: createPoll,
    });
    runtime.registry.register({
      name: "etkinlik",
      aliases: ["event"],
      module: "giveaways",
      description: "event.desc",
      usage: ".etkinlik 1d Title | Description OR .etkinlik cancel event-id",
      permission: "events.manage",
      nativePermission: PermissionFlagsBits.ManageEvents,
      cooldown: 10000,
      execute: createEvent,
    });
    runtime.interactions.set("community", {
      module: "giveaways",
      handle: component,
    });
    runtime.scheduler.register("giveaway.end", async (job) => {
      const { id } = job.payload as { id: string };
      await locked(`${job.guild}:${id}`, async () => {
        const service = new GiveawayService(runtime.db);
        const s = service.get(job.guild, id);
        const result = service.finish(
          job.guild,
          id,
          s.status === "ended" ? [] : await eligibleEntrants(runtime, s),
        );
        await safeEdit(runtime, result, "giveaway");
      });
    });
    runtime.scheduler.register("poll.end", async (job) => {
      const { id } = job.payload as { id: string };
      await locked(`${job.guild}:${id}`, async () => {
        const result = new PollService(runtime.db).finish(job.guild, id);
        await safeEdit(runtime, result, "poll");
      });
    });
    runtime.scheduler.register("event.remind", async (job) => {
      const { id } = job.payload as { id: string };
      await locked(`${job.guild}:${id}`, async () => {
        const service = new EventService(runtime.db);
        const s = service.get(job.guild, id);
        if (s.status !== "scheduled" || s.reminded) return;
        await safeEdit(runtime, { ...s, reminded: true }, "event");
        service.markReminder(job.guild, id);
      });
    });
    runtime.scheduler.register("event.start", async (job) => {
      const { id } = job.payload as { id: string };
      await locked(`${job.guild}:${id}`, async () => {
        const s = new EventService(runtime.db).start(job.guild, id);
        await safeEdit(runtime, s, "event");
      });
    });
  },
};
