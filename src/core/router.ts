import { randomUUID } from "node:crypto";
import {
  Events,
  MessageFlags,
  type Interaction,
  type Message,
  type GuildMember,
} from "discord.js";
import { ZodError } from "zod";
import { t } from "./localization.js";
import { parsePrefix } from "./registry.js";
import type { Runtime, CommandContext } from "./types.js";
import { assert, UserError } from "../shared.js";
export function errorText(
  runtime: Runtime,
  guild: string | undefined,
  error: unknown,
  id: string,
): string {
  const locale = guild ? runtime.settings.get(guild).locale : "tr";
  if (error instanceof UserError) return t(locale, error.key, error.vars);
  if (error instanceof ZodError) return t(locale, "error.input");
  runtime.logger.error({ err: error, reference: id }, "Operation failed");
  return t(locale, "error.internal", { id });
}
export async function routeMessage(
  runtime: Runtime,
  message: Message,
): Promise<void> {
  if (!message.guild || message.author.bot || message.webhookId) return;
  const parsed = parsePrefix(message.content);
  if (parsed) {
    const member =
      message.member ?? (await message.guild.members.fetch(message.author.id));
    const ctx: CommandContext = {
      runtime,
      guild: message.guild,
      member,
      user: message.author,
      channel: message.channel,
      args: parsed.args,
      locale: runtime.settings.get(message.guild.id).locale,
      requestId: message.id,
      message,
      reply: async (options) => {
        await message.reply(
          typeof options === "string"
            ? {
                content: options,
                allowedMentions: { parse: [], repliedUser: false },
              }
            : {
                ...options,
                allowedMentions: { parse: [], repliedUser: false },
              },
        );
      },
    };
    try {
      await runtime.registry.execute(parsed.name, ctx);
    } catch (error) {
      await ctx.reply(errorText(runtime, message.guild.id, error, message.id));
    }
  }
  for (const hook of runtime.messageHooks)
    if (runtime.settings.enabled(message.guild.id, hook.module)) {
      try {
        await hook.handle(message);
      } catch (err) {
        runtime.logger.error(
          { err, module: hook.module },
          "Message hook failed",
        );
      }
    }
}
export async function routeInteraction(
  runtime: Runtime,
  i: Interaction,
): Promise<void> {
  if (!i.isRepliable()) return;
  const ref = randomUUID().slice(0, 8);
  try {
    assert(i.guildId && i.guild, "error.permission");
    if (i.isChatInputCommand()) {
      if (i.commandName !== "executive") return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const member = await i.guild.members.fetch(i.user.id);
      const sub = i.options.getSubcommand();
      const name = sub === "run" ? i.options.getString("command", true) : sub;
      const args =
        sub === "language"
          ? [i.options.getString("locale", true)]
          : (i.options.getString("arguments") ?? "")
              .trim()
              .split(/\s+/)
              .filter(Boolean);
      assert(i.channel, "error.input");
      const ctx: CommandContext = {
        runtime,
        guild: i.guild,
        member,
        user: i.user,
        channel: i.channel,
        args,
        locale: runtime.settings.get(i.guildId).locale,
        requestId: i.id,
        reply: async (options) => {
          if (typeof options === "string")
            await i.editReply({
              content: options,
              allowedMentions: { parse: [] },
            });
          else {
            const { flags: _flags, ...edit } = options;
            await i.editReply({ ...edit, allowedMentions: { parse: [] } });
          }
        },
      };
      assert(await runtime.registry.execute(name, ctx), "error.input");
      return;
    }
    if (i.isMessageComponent() || i.isModalSubmit()) {
      runtime.permissions.consumeLimit(
        i.guildId,
        i.user.id,
        "interactions",
        60,
      );
      runtime.permissions.consumeLimit(i.guildId, "guild", "interactions", 240);
      const route = runtime.interactions.get(i.customId.split(":")[0]!);
      assert(route, "error.expired");
      assert(
        runtime.settings.enabled(i.guildId, route.module),
        "error.disabled",
      );
      await route.handle(i, runtime);
    }
  } catch (error) {
    const content = errorText(runtime, i.guildId ?? undefined, error, ref);
    if (i.deferred && !i.replied && i.ephemeral === true)
      await i
        .editReply({ content, allowedMentions: { parse: [] } })
        .catch((err) =>
          runtime.logger.warn({ err }, "Interaction error reply failed"),
        );
    else if (i.replied || i.deferred)
      await i
        .followUp({
          content,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        })
        .catch((err) =>
          runtime.logger.warn({ err }, "Interaction error reply failed"),
        );
    else
      await i
        .reply({
          content,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        })
        .catch((err) =>
          runtime.logger.warn({ err }, "Interaction error reply failed"),
        );
  }
}
export function attachRouter(runtime: Runtime): () => Promise<void> {
  const { client, logger } = runtime;
  const pending = new Set<Promise<void>>();
  const track = (task: Promise<void>) => {
    const caught = task.catch((err) =>
      logger.error({ err }, "Event handler failed"),
    );
    pending.add(caught);
    void caught.finally(() => pending.delete(caught));
  };
  client.on(Events.MessageCreate, (m) => {
    track(routeMessage(runtime, m));
  });
  client.on(Events.InteractionCreate, (i) => {
    track(routeInteraction(runtime, i));
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    for (const hook of runtime.voiceHooks)
      if (runtime.settings.enabled(newState.guild.id, hook.module))
        track(hook.handle(oldState, newState));
  });
  client.on(Events.GuildMemberAdd, (member) => {
    for (const hook of runtime.memberHooks)
      if (hook.join && runtime.settings.enabled(member.guild.id, hook.module))
        track(hook.join(member));
  });
  client.on(Events.GuildMemberRemove, (member) => {
    for (const hook of runtime.memberHooks)
      if (hook.leave && runtime.settings.enabled(member.guild.id, hook.module))
        track(hook.leave(member as GuildMember));
  });
  client.on(Events.Error, (err) =>
    logger.error({ err }, "Discord client error"),
  );
  client.rest.on("rateLimited", (data) =>
    logger.warn(
      { route: data.route, timeToReset: data.timeToReset },
      "Discord rate limit; REST queue handles retry",
    ),
  );
  return async () => {
    client.removeAllListeners();
    while (pending.size) await Promise.allSettled([...pending]);
  };
}
