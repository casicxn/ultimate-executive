import { randomUUID } from "node:crypto";
import {
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  type Guild,
  type GuildMember,
  type TextChannel,
  type Role,
} from "discord.js";
import type { Runtime } from "../../core/types.js";
import { t } from "../../core/localization.js";
import { assert, UserError, safeText } from "../../shared.js";

export interface TicketConfig {
  supportRole: string;
  categoryId?: string;
  logChannelId?: string;
  transcript: boolean;
}
export interface TicketRecord {
  id: string;
  owner: string;
  supportRole: string;
  channel?: string;
  created: number;
  state: "creating" | "open" | "closing" | "closed" | "uncertain" | "failed";
  claimedBy?: string;
  closedBy?: string;
  closedAt?: number;
  lastError?: string;
}
export const supportDangerous =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers;
export class TicketService {
  constructor(readonly runtime: Runtime) {}
  config(guild: string): TicketConfig {
    const config = this.runtime.settings.moduleConfig<TicketConfig | undefined>(
      guild,
      "tickets",
      undefined,
    );
    assert(config?.supportRole, "ticket.setupRequired");
    return config;
  }
  isStaff(member: GuildMember, ticket: TicketRecord): boolean {
    return (
      this.runtime.permissions.canConfigure(member) ||
      member.roles.cache.has(ticket.supportRole)
    );
  }
  canAccess(member: GuildMember, ticket: TicketRecord): boolean {
    return member.id === ticket.owner || this.isStaff(member, ticket);
  }
  async validateRole(guild: Guild, role: Role): Promise<void> {
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    assert(
      role.id !== guild.id &&
        !role.managed &&
        (role.permissions.bitfield & supportDangerous) === 0n &&
        role.comparePositionTo(bot.roles.highest) < 0,
      "ticket.roleUnsafe",
    );
  }
  async configure(guild: Guild, config: TicketConfig): Promise<void> {
    const role = await guild.roles.fetch(config.supportRole);
    assert(role);
    await this.validateRole(guild, role);
    if (config.categoryId) {
      const category = await guild.channels.fetch(config.categoryId);
      assert(category?.type === ChannelType.GuildCategory);
    }
    if (config.logChannelId) {
      const log = await guild.channels.fetch(config.logChannelId);
      assert(log?.type === ChannelType.GuildText);
    }
    this.runtime.settings.setModuleConfig(guild.id, "tickets", config);
  }
  reserve(guild: string, owner: string, supportRole: string): TicketRecord {
    return this.runtime.db.transaction(() => {
      const active = this.runtime.db.get<string>(guild, "ticketActive", owner);
      if (active) {
        const record = this.runtime.db.get<TicketRecord>(
          guild,
          "tickets",
          active,
        );
        if (record && !["closed", "failed"].includes(record.state))
          throw new UserError("ticket.existing", {
            channel: record.channel
              ? `<#${record.channel}>`
              : t(
                  this.runtime.settings.get(guild).locale,
                  `ticket.status.${record.state}`,
                ),
          });
      }
      const record: TicketRecord = {
        id: randomUUID(),
        owner,
        supportRole,
        created: Date.now(),
        state: "creating",
      };
      this.runtime.db.set(guild, "tickets", record.id, record);
      this.runtime.db.set(guild, "ticketActive", owner, record.id);
      return record;
    });
  }
  active(guild: string, owner: string): TicketRecord | undefined {
    const id = this.runtime.db.get<string>(guild, "ticketActive", owner);
    return id ? this.runtime.db.get(guild, "tickets", id) : undefined;
  }
  byChannel(guild: string, channel: string): TicketRecord {
    const id = this.runtime.db.get<string>(guild, "ticketChannels", channel);
    const ticket = id
      ? this.runtime.db.get<TicketRecord>(guild, "tickets", id)
      : undefined;
    assert(ticket && ticket.channel === channel, "ticket.notTicket");
    return ticket;
  }
  associate(
    guild: string,
    record: TicketRecord,
    channel: string,
  ): TicketRecord {
    return this.runtime.db.transaction(() => {
      const next: TicketRecord = { ...record, channel, state: "open" };
      this.runtime.db.set(guild, "tickets", record.id, next);
      this.runtime.db.set(guild, "ticketChannels", channel, record.id);
      return next;
    });
  }
  async reconcile(
    guild: Guild,
    owner: string,
  ): Promise<TicketRecord | undefined> {
    const ticket = this.active(guild.id, owner);
    assert(ticket, "ticket.notTicket");
    if (ticket.channel) return ticket;
    const channels = await guild.channels.fetch();
    const matches = [...channels.values()].filter(
      (channel): channel is TextChannel =>
        channel?.type === ChannelType.GuildText &&
        channel.topic === `Executive ticket=${ticket.id} owner=${owner}`,
    );
    assert(matches.length <= 1, "ticket.pending");
    const found = matches[0];
    if (!found) return;
    return this.associate(guild.id, ticket, found.id);
  }
  async reset(guild: Guild, owner: string): Promise<void> {
    const ticket = this.active(guild.id, owner);
    assert(
      ticket &&
        ["creating", "uncertain"].includes(ticket.state) &&
        !ticket.channel,
      "ticket.notOpen",
    );
    assert(Date.now() - ticket.created >= 300000, "ticket.resetWait");
    assert(!(await this.reconcile(guild, owner)), "ticket.existing", {
      channel: ticket.channel ?? "",
    });
    this.runtime.db.transaction(() => {
      const current = this.active(guild.id, owner);
      assert(current?.id === ticket.id && !current.channel, "ticket.pending");
      this.runtime.db.set(guild.id, "tickets", ticket.id, {
        ...ticket,
        state: "failed",
      });
      this.runtime.db.delete(guild.id, "ticketActive", owner);
    });
  }
  async open(
    guild: Guild,
    member: GuildMember,
  ): Promise<{ record: TicketRecord; channel: TextChannel; fresh: boolean }> {
    const config = this.config(guild.id);
    const prior = this.active(guild.id, member.id);
    if (prior) {
      if (prior.channel)
        throw new UserError("ticket.existing", {
          channel: `<#${prior.channel}>`,
        });
      const restored = await this.reconcile(guild, member.id);
      if (restored?.channel) {
        const channel = await guild.channels.fetch(restored.channel);
        assert(channel?.type === ChannelType.GuildText);
        return { record: restored, channel, fresh: false };
      }
      throw new UserError("ticket.pending");
    }
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    assert(
      bot.permissions.has(PermissionFlagsBits.ManageChannels),
      "error.permission",
    );
    const role = await guild.roles.fetch(config.supportRole);
    assert(role);
    await this.validateRole(guild, role);
    if (config.categoryId) {
      const category = await guild.channels.fetch(config.categoryId);
      assert(category?.type === ChannelType.GuildCategory);
      assert(
        category.permissionsFor(bot).has(PermissionFlagsBits.ManageChannels),
        "error.permission",
      );
    }
    const record = this.reserve(guild.id, member.id, role.id);
    let channel: TextChannel;
    try {
      channel = await guild.channels.create({
        name: `ticket-${member.id.slice(-6)}-${record.id.slice(0, 6)}`,
        type: ChannelType.GuildText,
        parent: config.categoryId,
        topic: `Executive ticket=${record.id} owner=${member.id}`,
        reason: `Executive ticket=${record.id} opener=${member.id}`,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: bot.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ManageChannels,
            ],
          },
          {
            id: role.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });
    } catch (error) {
      const definitive =
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number" &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429;
      this.runtime.db.transaction(() => {
        this.runtime.db.set(guild.id, "tickets", record.id, {
          ...record,
          state: definitive ? "failed" : "uncertain",
          lastError:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Unknown error",
        });
        if (definitive)
          this.runtime.db.delete(guild.id, "ticketActive", member.id);
      });
      if (!definitive) throw new UserError("ticket.pending");
      throw error;
    }
    const saved = this.associate(guild.id, record, channel.id);
    await this.log(guild.id, saved, "open", member.id);
    return { record: saved, channel, fresh: true };
  }
  privateChannel(channel: TextChannel, ticket: TicketRecord): void {
    assert(
      channel.permissionOverwrites.cache
        .get(channel.guild.id)
        ?.deny.has(PermissionFlagsBits.ViewChannel),
      "ticket.unsafeChannel",
    );
    const allowed = new Set([
      ticket.owner,
      ticket.supportRole,
      this.runtime.client.user?.id,
    ]);
    assert(
      !channel.permissionOverwrites.cache.some(
        (overwrite) =>
          overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
          !allowed.has(overwrite.id),
      ),
      "ticket.unsafeChannel",
    );
  }
  async close(
    channel: TextChannel,
    member: GuildMember,
  ): Promise<TicketRecord> {
    const ticket = this.byChannel(channel.guild.id, channel.id);
    assert(this.canAccess(member, ticket), "error.permission");
    assert(
      ticket.state === "open" || ticket.state === "closing",
      "ticket.notOpen",
    );
    this.privateChannel(channel, ticket);
    this.runtime.db.set(channel.guild.id, "tickets", ticket.id, {
      ...ticket,
      state: "closing",
    });
    // Retain the private channel and history; only freeze the opener’s ability to send.
    await channel.permissionOverwrites.edit(
      ticket.owner,
      { SendMessages: false },
      { reason: `Executive ticket=${ticket.id} closer=${member.id}` },
    );
    const closed: TicketRecord = {
      ...ticket,
      state: "closed",
      closedAt: Date.now(),
      closedBy: member.id,
    };
    this.runtime.db.transaction(() => {
      this.runtime.db.set(channel.guild.id, "tickets", ticket.id, closed);
      if (
        this.runtime.db.get(channel.guild.id, "ticketActive", ticket.owner) ===
        ticket.id
      )
        this.runtime.db.delete(channel.guild.id, "ticketActive", ticket.owner);
    });
    await this.log(channel.guild.id, closed, "close", member.id);
    return closed;
  }
  claim(guild: string, channel: string, member: GuildMember): TicketRecord {
    return this.runtime.db.transaction(() => {
      const ticket = this.byChannel(guild, channel);
      assert(this.isStaff(member, ticket), "error.permission");
      assert(ticket.state === "open", "ticket.notOpen");
      assert(
        !ticket.claimedBy || ticket.claimedBy === member.id,
        "ticket.alreadyClaimed",
      );
      const claimed = { ...ticket, claimedBy: member.id };
      this.runtime.db.set(guild, "tickets", ticket.id, claimed);
      return claimed;
    });
  }
  async transcript(
    channel: TextChannel,
    member: GuildMember,
  ): Promise<{ file: AttachmentBuilder; count: number }> {
    const ticket = this.byChannel(channel.guild.id, channel.id);
    assert(this.config(channel.guild.id).transcript, "ticket.transcriptOff");
    assert(this.canAccess(member, ticket), "error.permission");
    this.privateChannel(channel, ticket);
    const messages = await channel.messages.fetch({ limit: 100 });
    const rows = [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((message) => ({
        id: message.id,
        author: {
          id: message.author.id,
          name: safeText(message.author.username, 100),
        },
        created: message.createdAt.toISOString(),
        content: safeText(message.content, 4000),
        attachments: message.attachments.map((attachment) => ({
          name: safeText(attachment.name, 200),
          size: attachment.size,
        })),
      }));
    const data = {
      ticket: ticket.id,
      channel: channel.id,
      owner: ticket.owner,
      requestedBy: member.id,
      exportedAt: new Date().toISOString(),
      limit: 100,
      messages: rows,
    };
    await this.log(channel.guild.id, ticket, "transcript", member.id);
    return {
      file: new AttachmentBuilder(
        Buffer.from(JSON.stringify(data, null, 2), "utf8"),
        { name: `ticket-${ticket.id}.json` },
      ),
      count: rows.length,
    };
  }
  async log(
    guild: string,
    ticket: TicketRecord,
    action: string,
    actor: string,
  ): Promise<void> {
    this.runtime.logger.info(
      { guild, ticket: ticket.id, action, actor },
      "Ticket action",
    );
    const config = this.config(guild);
    if (!config.logChannelId) return;
    try {
      const channel = await this.runtime.client.channels.fetch(
        config.logChannelId,
      );
      if (channel?.isSendable())
        await channel.send({
          content: t(this.runtime.settings.get(guild).locale, "ticket.log", {
            action,
            id: ticket.id,
            user: ticket.owner,
            channel: ticket.channel ?? "-",
            actor,
          }),
          allowedMentions: { parse: [] },
        });
    } catch (error) {
      this.runtime.logger.warn(
        { err: error, ticket: ticket.id },
        "Ticket log delivery failed",
      );
    }
  }
}
