import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection, PermissionFlagsBits, type Role } from "discord.js";
import { Store } from "../src/database/store.js";
import { Settings } from "../src/core/settings.js";
import {
  EconomyService,
  safeRewardRole,
  type ShopItem,
} from "../src/modules/economy/service.js";
import { economyModule } from "../src/modules/economy/index.js";
import { createRuntime } from "../src/core/runtime.js";
import type { CommandContext } from "../src/core/types.js";

let db: Store, settings: Settings, economy: EconomyService;
beforeEach(() => {
  db = new Store(":memory:");
  settings = new Settings(db);
  economy = new EconomyService(db, settings);
});
afterEach(() => {
  db?.close();
  vi.restoreAllMocks();
});
const guild = "guild";
function item(type: ShopItem["type"] = "collectible"): ShopItem {
  return {
    id: "star",
    name: "Star",
    price: 100,
    type,
    rarity: "rare",
    value: 40,
  };
}

describe("transactional virtual economy", () => {
  it("isolates guild wallets and applies a credit receipt only once", () => {
    economy.credit(guild, "alice", 300, "game:one");
    economy.credit(guild, "alice", 300, "game:one");
    expect(economy.balance(guild, "alice")).toBe(300);
    expect(economy.balance("other", "alice")).toBe(0);
    economy.credit("other", "alice", 20, "game:one");
    expect(economy.balance("other", "alice")).toBe(20);
  });
  it("transfers atomically and ignores replayed request IDs", () => {
    economy.credit(guild, "alice", 1000, "seed");
    economy.transfer(guild, "alice", "bob", 300, "pay:one");
    economy.transfer(guild, "alice", "bob", 300, "pay:one");
    expect(economy.balance(guild, "alice")).toBe(700);
    expect(economy.balance(guild, "bob")).toBe(300);
  });
  it("rejects self transfers, negative values, fractions, unsafe integers, and insufficient funds", () => {
    for (const amount of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        economy.transfer(guild, "alice", "bob", amount, "bad"),
      ).toThrow();
    expect(() => economy.transfer(guild, "alice", "alice", 1, "self")).toThrow(
      "economy.self",
    );
    expect(() =>
      economy.transfer(guild, "alice", "bob", 1, "overdraw"),
    ).toThrow("economy.insufficient");
    expect(economy.balance(guild, "bob")).toBe(0);
  });
  it("rolls back sender debit when recipient would overflow", () => {
    settings.setModuleConfig(guild, "economy", { maxBalance: 1000 });
    economy.credit(guild, "alice", 100, "seed:a");
    economy.credit(guild, "bob", 1000, "seed:b");
    expect(() =>
      economy.transfer(guild, "alice", "bob", 1, "overflow"),
    ).toThrow("economy.overflow");
    expect(economy.balance(guild, "alice")).toBe(100);
    expect(economy.balance(guild, "bob")).toBe(1000);
    expect(db.get(guild, "economyLedger", "overflow")).toBeUndefined();
  });
  it("persists daily, weekly and work cooldowns separately per guild", () => {
    expect(economy.claim(guild, "alice", "daily", 1000000)).toBe(200);
    expect(() => economy.claim(guild, "alice", "daily", 1000001)).toThrow(
      "error.cooldown",
    );
    expect(economy.claim(guild, "alice", "weekly", 1000001)).toBe(1500);
    expect(economy.claim("other", "alice", "daily", 1000001)).toBe(200);
    expect(economy.claim(guild, "alice", "daily", 1000000 + 86400000)).toBe(
      200,
    );
  });
  it("cannot multiply rewards through rapid repeated collection", () => {
    const results = Array.from({ length: 20 }, () => {
      try {
        return economy.claim(guild, "alice", "work", 50000);
      } catch {
        return 0;
      }
    });
    expect(results.reduce((a, b) => a + b, 0)).toBe(75);
    expect(economy.balance(guild, "alice")).toBe(75);
  });
  it("persists wallets and claim cooldowns through database reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "executive-economy-"));
    let persistent: Store | undefined;
    try {
      const path = join(dir, "data.sqlite");
      persistent = new Store(path);
      let svc = new EconomyService(persistent, new Settings(persistent));
      svc.claim(guild, "alice", "daily", 1000000);
      persistent.close();
      persistent = new Store(path);
      svc = new EconomyService(persistent, new Settings(persistent));
      expect(svc.balance(guild, "alice")).toBe(200);
      expect(() => svc.claim(guild, "alice", "daily", 1000001)).toThrow(
        "error.cooldown",
      );
    } finally {
      persistent?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("purchases and sells without duplicate inventory or money", () => {
    db.set(guild, "shop", "star", item());
    economy.credit(guild, "alice", 500, "seed");
    economy.buy(guild, "alice", "star", "buy:1");
    economy.buy(guild, "alice", "star", "buy:1");
    expect(economy.inventory(guild, "alice").items.star).toBe(1);
    expect(economy.balance(guild, "alice")).toBe(400);
    economy.sell(guild, "alice", "star", "sell:1");
    economy.sell(guild, "alice", "star", "sell:1");
    expect(economy.inventory(guild, "alice").items.star).toBe(0);
    expect(economy.balance(guild, "alice")).toBe(450);
    expect(() => economy.sell(guild, "alice", "star", "sell:2")).toThrow(
      "economy.notOwned",
    );
  });
  it("keeps a failed purchase and overflowed sale atomic", () => {
    db.set(guild, "shop", "star", item());
    expect(() => economy.buy(guild, "alice", "star", "buy:1")).toThrow();
    expect(economy.inventory(guild, "alice").items.star).toBeUndefined();
    settings.setModuleConfig(guild, "economy", { maxBalance: 1000 });
    economy.credit(guild, "alice", 1000, "seed");
    economy.buy(guild, "alice", "star", "buy:2");
    economy.credit(guild, "alice", 100, "topup");
    expect(() => economy.sell(guild, "alice", "star", "sell:1")).toThrow(
      "economy.overflow",
    );
    expect(economy.inventory(guild, "alice").items.star).toBe(1);
  });
  it("consumes items once and equips collectible badges without consuming them", () => {
    db.set(guild, "shop", "star", item("consumable"));
    economy.credit(guild, "alice", 200, "seed");
    economy.buy(guild, "alice", "star", "buy:1");
    economy.use(guild, "alice", "star", "use:1");
    economy.use(guild, "alice", "star", "use:1");
    expect(economy.balance(guild, "alice")).toBe(140);
    expect(economy.inventory(guild, "alice").items.star).toBe(0);
    expect(() => economy.use(guild, "alice", "star", "use:2")).toThrow(
      "economy.notOwned",
    );
    db.set(guild, "shop", "star", item("badge"));
    economy.buy(guild, "alice", "star", "buy:2");
    economy.use(guild, "alice", "star", "badge:1");
    economy.use(guild, "alice", "star", "badge:2");
    expect(economy.inventory(guild, "alice").badges).toEqual(["Star"]);
  });
  it("rejects administrative, unapproved, managed and high role rewards", () => {
    const role = (bits: bigint, position = 1, managed = false) =>
      ({
        id: "reward",
        guild: { id: guild },
        permissions: { bitfield: bits },
        position,
        managed,
      }) as Role;
    expect(safeRewardRole(role(0n), 10)).toBe(true);
    expect(safeRewardRole(role(PermissionFlagsBits.SendMessages), 10)).toBe(
      true,
    );
    for (const bits of [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ViewAuditLog,
    ])
      expect(safeRewardRole(role(bits), 10)).toBe(false);
    expect(safeRewardRole(role(0n, 10), 10)).toBe(false);
    expect(safeRewardRole(role(0n, 1, true), 10)).toBe(false);
    const hiddenPower = role(0n);
    Object.assign(hiddenPower.guild, {
      channels: {
        cache: new Collection([
          [
            "c",
            {
              permissionOverwrites: {
                cache: new Collection([
                  [
                    "reward",
                    { allow: { bitfield: PermissionFlagsBits.ManageWebhooks } },
                  ],
                ]),
              },
            },
          ],
        ]),
      },
    });
    expect(safeRewardRole(hiddenPower, 10)).toBe(false);
  });
  it("rechecks custom staff/public-role authorization before a role purchase or use", async () => {
    const runtime = createRuntime(":memory:", "owner", "silent");
    economyModule.register(runtime);
    const service = new EconomyService(runtime.db, runtime.settings);
    service.credit(guild, "alice", 500, "seed");
    runtime.db.set(guild, "shop", "blue", {
      ...item("role"),
      id: "blue",
      roleId: "reward",
    });
    const role = {
      id: "reward",
      guild: { id: guild, channels: { cache: new Collection() } },
      permissions: { bitfield: 0n },
      position: 1,
      managed: false,
    } as unknown as Role;
    const add = vi.fn();
    const roleGuard = vi
      .spyOn(runtime.permissions, "canAssignPublicRole")
      .mockResolvedValue(false);
    const ctx = {
      runtime,
      guild: {
        id: guild,
        roles: { fetch: vi.fn().mockResolvedValue(role) },
        members: { me: { roles: { highest: { position: 10 } } } },
      },
      member: { roles: { add } },
      user: { id: "alice" },
      args: ["blue"],
      requestId: "request",
      locale: "tr",
      reply: vi.fn(),
    } as unknown as CommandContext;
    try {
      await expect(runtime.registry.find("buy")!.execute(ctx)).rejects.toThrow(
        "economy.roleUnsafe",
      );
      expect(service.balance(guild, "alice")).toBe(500);
      expect(service.inventory(guild, "alice").items.blue).toBeUndefined();
      runtime.db.set(guild, "inventories", "alice", {
        items: { blue: 1 },
        badges: [],
      });
      await expect(runtime.registry.find("use")!.execute(ctx)).rejects.toThrow(
        "economy.roleUnsafe",
      );
      expect(add).not.toHaveBeenCalled();
      expect(roleGuard).toHaveBeenCalledTimes(2);
      expect(service.inventory(guild, "alice").items.blue).toBe(1);
    } finally {
      runtime.db.close();
      await runtime.client.destroy();
    }
  });
});
