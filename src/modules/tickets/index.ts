import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  type TextChannel,
} from "discord.js";
import type { Module, CommandContext } from "../../core/types.js";
import { t } from "../../core/localization.js";
import { assert, userId } from "../../shared.js";
import { TicketService, type TicketRecord } from "./service.js";
import "./translations.js";

interface TicketPanel {
  id: string;
  channel: string;
  message: string;
  created: number;
}
export const ticketsModule: Module = {
  name: "tickets",
  register(runtime) {
    const service = new TicketService(runtime);
    const controls = (locale: "tr" | "en", ticket: TicketRecord) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:close:${ticket.id}`)
          .setLabel(t(locale, "ticket.close"))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket:claim:${ticket.id}`)
          .setLabel(t(locale, "ticket.claim"))
          .setStyle(ButtonStyle.Primary),
      );
    async function ticketChannel(ctx: CommandContext): Promise<TextChannel> {
      const channel = await ctx.guild.channels.fetch(ctx.channel.id);
      assert(channel?.type === ChannelType.GuildText, "ticket.notTicket");
      return channel;
    }
    async function welcome(
      channel: TextChannel,
      ticket: TicketRecord,
    ): Promise<void> {
      await channel.send({
        content: t(
          runtime.settings.get(channel.guild.id).locale,
          "ticket.welcome",
          { user: ticket.owner },
        ),
        components: [
          controls(runtime.settings.get(channel.guild.id).locale, ticket),
        ],
        allowedMentions: { parse: [] },
      });
    }
    runtime.registry.register({
      name: "ticket",
      module: "tickets",
      description: "ticket.description",
      usage: ".ticket",
      cooldown: 3000,
      execute: async (ctx) => {
        const operation = ctx.args[0];
        if (operation === "setup") {
          assert(
            runtime.permissions.canConfigure(ctx.member),
            "error.permission",
          );
          const supportRole = userId(ctx.args[1]);
          const categoryId =
            ctx.args[2] && ctx.args[2] !== "-"
              ? userId(ctx.args[2])
              : undefined;
          const logChannelId =
            ctx.args[3] && ctx.args[3] !== "-"
              ? userId(ctx.args[3])
              : undefined;
          assert(!ctx.args[4] || ["on", "off"].includes(ctx.args[4]));
          await service.configure(ctx.guild, {
            supportRole,
            categoryId,
            logChannelId,
            transcript: ctx.args[4] === "on",
          });
          await ctx.reply(t(ctx.locale, "common.ok"));
        } else if (operation === "panel") {
          assert(
            runtime.permissions.canConfigure(ctx.member),
            "error.permission",
          );
          service.config(ctx.guild.id);
          assert(ctx.channel.isSendable());
          const id = randomUUID();
          const message = await ctx.channel.send({
            content: t(ctx.locale, "ticket.panel"),
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId(`ticket:open:${id}`)
                  .setLabel(t(ctx.locale, "ticket.open"))
                  .setStyle(ButtonStyle.Primary),
              ),
            ],
            allowedMentions: { parse: [] },
          });
          runtime.db.set<TicketPanel>(ctx.guild.id, "ticketPanels", id, {
            id,
            channel: message.channelId,
            message: message.id,
            created: Date.now(),
          });
          await ctx.reply(t(ctx.locale, "common.ok"));
        } else if (operation === "open") {
          const { record, channel, fresh } = await service.open(
            ctx.guild,
            ctx.member,
          );
          if (fresh) await welcome(channel, record);
          await ctx.reply(
            t(ctx.locale, "ticket.created", { channel: channel.id }),
          );
        } else if (operation === "close") {
          await service.close(await ticketChannel(ctx), ctx.member);
          await ctx.reply(t(ctx.locale, "ticket.closed"));
        } else if (operation === "claim") {
          service.claim(ctx.guild.id, ctx.channel.id, ctx.member);
          await ctx.reply(
            t(ctx.locale, "ticket.claimed", { user: ctx.user.id }),
          );
        } else if (operation === "transcript") {
          const { file, count } = await service.transcript(
            await ticketChannel(ctx),
            ctx.member,
          );
          await ctx.reply({
            content: t(ctx.locale, "ticket.transcript", { count }),
            files: [file],
          });
        } else if (operation === "reconcile" || operation === "reset") {
          assert(
            runtime.permissions.canConfigure(ctx.member),
            "error.permission",
          );
          const owner = userId(ctx.args[1]);
          if (operation === "reset") {
            await service.reset(ctx.guild, owner);
            await ctx.reply(t(ctx.locale, "ticket.reset"));
          } else {
            const record = await service.reconcile(ctx.guild, owner);
            assert(record?.channel, "ticket.pending");
            await ctx.reply(
              t(ctx.locale, "ticket.reconciled", { channel: record.channel }),
            );
          }
        } else await ctx.reply(t(ctx.locale, "ticket.usage"));
      },
    });
    runtime.interactions.set("ticket", {
      module: "tickets",
      handle: async (interaction) => {
        assert(
          interaction.isButton() && interaction.guild && interaction.guildId,
          "error.input",
        );
        const guild = interaction.guild;
        const locale = runtime.settings.get(guild.id).locale;
        const [, action, id] = interaction.customId.split(":");
        assert(id);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await guild.members.fetch(interaction.user.id);
        runtime.permissions.consumeLimit(
          guild.id,
          member.id,
          "ticket-interaction",
          10,
        );
        if (action === "open") {
          const panel = runtime.db.get<TicketPanel>(
            guild.id,
            "ticketPanels",
            id,
          );
          assert(
            panel &&
              panel.channel === interaction.channelId &&
              panel.message === interaction.message.id,
            "error.expired",
          );
          const { record, channel, fresh } = await service.open(guild, member);
          if (fresh) await welcome(channel, record);
          await interaction.editReply({
            content: t(locale, "ticket.created", { channel: channel.id }),
            allowedMentions: { parse: [] },
          });
        } else {
          const ticket = service.byChannel(guild.id, interaction.channelId);
          assert(ticket.id === id, "error.permission");
          if (action === "claim") {
            service.claim(guild.id, interaction.channelId, member);
            await interaction.editReply({
              content: t(locale, "ticket.claimed", { user: member.id }),
              allowedMentions: { parse: [] },
            });
          } else if (action === "close") {
            const channel = await guild.channels.fetch(interaction.channelId);
            assert(channel?.type === ChannelType.GuildText);
            await service.close(channel, member);
            await interaction.editReply(t(locale, "ticket.closed"));
          } else assert(false, "error.input");
        }
      },
    });
  },
};
