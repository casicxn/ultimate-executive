import { afterEach, describe, expect, it, vi } from "vitest";
import { Collection, PermissionsBitField, type GuildMember } from "discord.js";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import { Permissions } from "../src/core/permissions.js";
import { Registry } from "../src/core/registry.js";
import type { Runtime, CommandContext } from "../src/core/types.js";
import { staffModule } from "../src/modules/staff/index.js";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function fixture() {
  const db = new Store(":memory:");
  stores.push(db);
  const settings = new Settings(db);
  const permissions = new Permissions(db, settings);
  return { db, settings, permissions };
}
function member(guild = "g", id = "u", position = 10): GuildMember {
  return {
    id,
    guild: {
      id: guild,
      ownerId: "owner",
      members: {
        me: {
          roles: {
            highest: {
              position: 100,
              comparePositionTo: (role: { position: number }) =>
                100 - role.position,
            },
          },
        },
      },
    },
    client: { user: { id: "bot" } },
    roles: {
      cache: new Collection([["staff", { id: "staff" }]]),
      highest: {
        position,
        comparePositionTo: (role: { position: number }) =>
          position - role.position,
      },
    },
    permissions: new PermissionsBitField(),
  } as unknown as GuildMember;
}
describe("staff authorization", () => {
  it("supports role, user and group grants with guild isolation", () => {
    const { db, permissions } = fixture();
    const actor = member();
    expect(permissions.can(actor, "ban")).toBe(false);
    db.set("g", "grants", "role:staff", {
      commands: ["kick"],
      groups: ["support"],
    });
    db.set("g", "permissionGroups", "support", ["warn", "sil"]);
    expect(permissions.can(actor, "kick")).toBe(true);
    expect(permissions.can(actor, "warn")).toBe(true);
    expect(permissions.can(actor, "ban")).toBe(false);
    db.set("g", "grants", "user:u", { commands: ["ban"], groups: [] });
    expect(permissions.can(actor, "ban")).toBe(true);
    expect(permissions.can(member("another"), "ban")).toBe(false);
  });
  it("never lets a config grant delegate configuration access", () => {
    const { db, settings, permissions } = fixture();
    db.set("g", "grants", "user:u", { commands: ["config"], groups: [] });
    expect(permissions.can(member(), "config")).toBe(false);
    settings.update("g", { configAdmins: ["u"] });
    expect(permissions.canConfigure(member())).toBe(true);
    expect(permissions.canConfigure(member("other"))).toBe(false);
  });
  it("requires actual actor rank even if the bot is above both users", () => {
    const { permissions } = fixture();
    expect(() =>
      permissions.assertTarget(member("g", "low", 5), member("g", "high", 10)),
    ).toThrow("error.permission");
    expect(() =>
      permissions.assertTarget(member("g", "high", 10), member("g", "low", 5)),
    ).not.toThrow();
    expect(() =>
      permissions.assertTarget(
        member("g", "high", 10),
        member("g", "equal", 10),
      ),
    ).toThrow("error.permission");
  });
  it("honors protected users, protected roles and guild owner", () => {
    const { permissions, settings } = fixture();
    settings.update("g", { protectedUsers: ["protected"] });
    expect(() =>
      permissions.assertTarget(
        member("g", "m", 20),
        member("g", "protected", 1),
      ),
    ).toThrow();
    settings.update("g", { protectedUsers: [], protectedRoles: ["staff"] });
    expect(() =>
      permissions.assertTarget(member("g", "m", 20), member("g", "target", 1)),
    ).toThrow();
    expect(() =>
      permissions.assertTarget(member("g", "m", 20), member("g", "owner", 1)),
    ).toThrow();
  });
  it("persists per-moderator action limits", () => {
    const { permissions } = fixture();
    permissions.consumeLimit("g", "u", "ban", 1, 1000);
    expect(() => permissions.consumeLimit("g", "u", "ban", 1, 1001)).toThrow(
      "error.cooldown",
    );
    expect(() =>
      permissions.consumeLimit("other", "u", "ban", 1, 1001),
    ).not.toThrow();
  });
  it("rejects configuration delegation by an existing delegated administrator", async () => {
    const { db, settings, permissions } = fixture();
    settings.update("g", { configAdmins: ["admin"] });
    const registry = new Registry();
    const runtime = {
      db,
      settings,
      permissions,
      registry,
      logger: { info: vi.fn() },
    } as unknown as Runtime;
    staffModule.register(runtime);
    const ctx = {
      runtime,
      guild: { id: "g", ownerId: "owner" },
      member: member("g", "admin"),
      user: { id: "admin" },
      args: ["admin", "111111111111111111"],
      locale: "en",
      reply: vi.fn(),
    } as unknown as CommandContext;
    await expect(registry.find("staff")!.execute(ctx)).rejects.toThrow(
      "staff.ownerOnly",
    );
  });
});
