import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  PermissionsBitField,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
  type Role,
} from "discord.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import { Permissions } from "../src/core/permissions.js";
import {
  TicketService,
  type TicketRecord,
} from "../src/modules/tickets/service.js";
import { ticketsModule } from "../src/modules/tickets/index.js";
import { Registry } from "../src/core/registry.js";
import type { Runtime } from "../src/core/types.js";

const stores: Store[] = [];
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});
function fixture(database?: Store) {
  const db = database ?? new Store(":memory:");
  if (!database) stores.push(db);
  const settings = new Settings(db);
  const permissions = new Permissions(db, settings);
  const runtime = {
    db,
    settings,
    permissions,
    logger: pino({ enabled: false }),
    client: { user: { id: "bot" }, channels: { fetch: vi.fn() } },
    registry: new Registry(),
    interactions: new Map(),
  } as unknown as Runtime;
  settings.setModuleConfig("g", "tickets", {
    supportRole: "support",
    transcript: false,
  });
  const bot = {
    id: "bot",
    permissions: new PermissionsBitField(PermissionFlagsBits.ManageChannels),
    roles: { highest: { position: 100 } },
  };
  const role = {
    id: "support",
    managed: false,
    permissions: new PermissionsBitField(),
    comparePositionTo: () => -1,
  } as unknown as Role;
  const channels = new Collection<string, TextChannel>();
  const guild = {
    id: "g",
    ownerId: "owner",
    members: { me: bot, fetchMe: vi.fn().mockResolvedValue(bot) },
    roles: { fetch: vi.fn().mockResolvedValue(role) },
    channels: {
      fetch: vi
        .fn()
        .mockImplementation(async (id?: string) =>
          id ? channels.get(id) : channels,
        ),
      create: vi.fn(),
    },
  } as unknown as Guild;
  const permissionOverwrites = {
    cache: new Collection([
      [
        "g",
        {
          id: "g",
          deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
          allow: new PermissionsBitField(),
        },
      ],
      [
        "opener",
        {
          id: "opener",
          deny: new PermissionsBitField(),
          allow: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
        },
      ],
      [
        "bot",
        {
          id: "bot",
          deny: new PermissionsBitField(),
          allow: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
        },
      ],
      [
        "support",
        {
          id: "support",
          deny: new PermissionsBitField(),
          allow: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
        },
      ],
    ]),
    edit: vi.fn().mockResolvedValue(undefined),
  };
  const channel = {
    id: "channel",
    guild,
    type: ChannelType.GuildText,
    topic: "",
    permissionOverwrites,
    messages: { fetch: vi.fn() },
    send: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
  } as unknown as TextChannel;
  vi.mocked(guild.channels.create).mockImplementation(async (options) => {
    channel.topic = options.topic ?? null;
    channels.set(channel.id, channel);
    return channel as never;
  });
  const member = (id: string, staff = false) =>
    ({
      id,
      guild,
      roles: { cache: new Collection(staff ? [["support", role]] : []) },
    }) as unknown as GuildMember;
  return {
    db,
    settings,
    permissions,
    runtime,
    service: new TicketService(runtime),
    guild,
    role,
    channel,
    channels,
    member,
  };
}
describe("ticket persistence and channel creation", () => {
  it("creates a private text channel with explicit overwrites independent of category inheritance", async () => {
    const f = fixture();
    f.settings.setModuleConfig("g", "tickets", {
      supportRole: "support",
      categoryId: "category",
      transcript: false,
    });
    const fetch = vi.mocked(f.guild.channels.fetch);
    fetch.mockImplementation(
      async (id?: string) =>
        (id === "category"
          ? {
              type: ChannelType.GuildCategory,
              permissionsFor: () =>
                new PermissionsBitField(PermissionFlagsBits.ManageChannels),
            }
          : f.channels) as never,
    );
    const result = await f.service.open(f.guild, f.member("opener"));
    expect(result.record.state).toBe("open");
    expect(f.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChannelType.GuildText,
        parent: "category",
        permissionOverwrites: expect.arrayContaining([
          { id: "g", deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: "opener",
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ]),
      }),
    );
    expect(f.service.byChannel("g", "channel").owner).toBe("opener");
    expect(f.db.get("other", "ticketActive", "opener")).toBeUndefined();
  });
  it("atomically allows only one open ticket for concurrent requests", async () => {
    const f = fixture();
    const results = await Promise.allSettled([
      f.service.open(f.guild, f.member("opener")),
      f.service.open(f.guild, f.member("opener")),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(f.db.list("g", "tickets")).toHaveLength(1);
  });
  it("retains reservations after restart and prevents duplicate channels", () => {
    const directory = mkdtempSync(join(tmpdir(), "executive-tickets-"));
    const path = join(directory, "db.sqlite");
    try {
      const first = new Store(path);
      const f = fixture(first);
      const reserved = f.service.reserve("g", "u", "support");
      first.close();
      const second = new Store(path);
      const reopened = fixture(second);
      expect(reopened.service.active("g", "u")?.id).toBe(reserved.id);
      expect(() => reopened.service.reserve("g", "u", "support")).toThrow(
        "ticket.existing",
      );
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("reconciles a channel created despite an uncertain API result without replaying create", async () => {
    const f = fixture();
    vi.mocked(f.guild.channels.create).mockImplementation(async (options) => {
      f.channel.topic = options.topic ?? null;
      f.channels.set(f.channel.id, f.channel);
      throw new Error("connection lost");
    });
    await expect(f.service.open(f.guild, f.member("opener"))).rejects.toThrow(
      "ticket.pending",
    );
    expect(f.service.active("g", "opener")?.state).toBe("uncertain");
    const reconciled = await f.service.open(f.guild, f.member("opener"));
    expect(reconciled).toMatchObject({
      fresh: false,
      record: { state: "open", channel: "channel" },
    });
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertain reservations until explicitly verified by an administrator", async () => {
    const f = fixture();
    vi.mocked(f.guild.channels.create).mockRejectedValue(new Error("timeout"));
    await expect(f.service.open(f.guild, f.member("opener"))).rejects.toThrow(
      "ticket.pending",
    );
    await expect(f.service.open(f.guild, f.member("opener"))).rejects.toThrow(
      "ticket.pending",
    );
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    await expect(f.service.reset(f.guild, "opener")).rejects.toThrow(
      "ticket.resetWait",
    );
  });
  it("releases reservations after a definitive forbidden response", async () => {
    const f = fixture();
    vi.mocked(f.guild.channels.create).mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    await expect(f.service.open(f.guild, f.member("opener"))).rejects.toThrow(
      "Forbidden",
    );
    expect(f.service.active("g", "opener")).toBeUndefined();
    expect(f.db.list<TicketRecord>("g", "tickets")[0]?.value.state).toBe(
      "failed",
    );
  });
});
describe("ticket access control", () => {
  it("allows only creator, support role and configuration managers to close", async () => {
    const f = fixture();
    await f.service.open(f.guild, f.member("opener"));
    await expect(
      f.service.close(f.channel, f.member("outsider")),
    ).rejects.toThrow("error.permission");
    await f.service.close(f.channel, f.member("opener"));
    expect(f.channel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "opener",
      { SendMessages: false },
      expect.any(Object),
    );
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.service.active("g", "opener")).toBeUndefined();
    expect(f.service.byChannel("g", "channel").state).toBe("closed");
  });
  it("only lets staff claim and prevents takeover by a second staff member", async () => {
    const f = fixture();
    await f.service.open(f.guild, f.member("opener"));
    expect(() => f.service.claim("g", "channel", f.member("opener"))).toThrow(
      "error.permission",
    );
    expect(
      f.service.claim("g", "channel", f.member("helper", true)).claimedBy,
    ).toBe("helper");
    expect(() =>
      f.service.claim("g", "channel", f.member("anotherHelper", true)),
    ).toThrow("ticket.alreadyClaimed");
  });
  it("requires explicit transcript opt-in, participant authorization and privacy", async () => {
    const f = fixture();
    await f.service.open(f.guild, f.member("opener"));
    await expect(
      f.service.transcript(f.channel, f.member("opener")),
    ).rejects.toThrow("ticket.transcriptOff");
    f.settings.setModuleConfig("g", "tickets", {
      supportRole: "support",
      transcript: true,
    });
    await expect(
      f.service.transcript(f.channel, f.member("outsider")),
    ).rejects.toThrow("error.permission");
    f.channel.permissionOverwrites.cache.delete("g");
    await expect(
      f.service.transcript(f.channel, f.member("opener")),
    ).rejects.toThrow("ticket.unsafeChannel");
  });
  it("exports at most 100 recent messages as sanitized JSON in the existing private channel", async () => {
    const f = fixture();
    await f.service.open(f.guild, f.member("opener"));
    f.settings.setModuleConfig("g", "tickets", {
      supportRole: "support",
      transcript: true,
    });
    vi.mocked(f.channel.messages.fetch).mockResolvedValue(
      new Collection([
        [
          "m",
          {
            id: "m",
            author: { id: "opener", username: "@everyone" },
            createdTimestamp: 1,
            createdAt: new Date(1),
            content: "hello @everyone",
            attachments: new Collection(),
          },
        ],
      ]) as never,
    );
    const transcript = await f.service.transcript(
      f.channel,
      f.member("opener"),
    );
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    expect(transcript.count).toBe(1);
    const text = (transcript.file.attachment as Buffer).toString("utf8");
    expect(text).toContain("＠everyone");
    expect(text).not.toContain('"@everyone"');
    expect(JSON.parse(text).requestedBy).toBe("opener");
  });
  it("rejects a privileged support role and missing bot ManageChannels", async () => {
    const f = fixture();
    Object.defineProperty(f.role, "permissions", {
      value: new PermissionsBitField(PermissionFlagsBits.Administrator),
      configurable: true,
    });
    await expect(f.service.open(f.guild, f.member("opener"))).rejects.toThrow(
      "ticket.roleUnsafe",
    );
    Object.defineProperty(f.role, "permissions", {
      value: new PermissionsBitField(),
      configurable: true,
    });
    Object.defineProperty(f.guild.members.me!, "permissions", {
      value: new PermissionsBitField(),
    });
    await expect(f.service.open(f.guild, f.member("opener"))).rejects.toThrow(
      "error.permission",
    );
  });
  it("registers persistent ticket routing without collectors", () => {
    const f = fixture();
    ticketsModule.register(f.runtime);
    expect(f.runtime.registry.find("ticket")).toBeDefined();
    expect(f.runtime.interactions.get("ticket")?.module).toBe("tickets");
  });
});
