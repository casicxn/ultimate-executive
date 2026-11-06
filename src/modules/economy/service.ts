import { PermissionFlagsBits, type Role } from "discord.js";
import { z } from "zod";
import type { Store } from "../../database/store.js";
import type { Settings } from "../../core/settings.js";
import { assert } from "../../shared.js";

export const economyConfigSchema = z.object({
  currency: z.string().min(1).max(30).default("Executive Coins"),
  maxBalance: z
    .number()
    .int()
    .min(1000)
    .max(1_000_000_000_000_000)
    .default(1_000_000_000_000),
  daily: z.number().int().min(0).max(1_000_000).default(200),
  weekly: z.number().int().min(0).max(10_000_000).default(1500),
  work: z.number().int().min(0).max(1_000_000).default(75),
  workCooldown: z.number().int().min(60_000).max(86_400_000).default(3_600_000),
});
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
export interface Wallet {
  balance: number;
  claims: Record<string, number>;
}
export interface ShopItem {
  id: string;
  name: string;
  price: number;
  type: "collectible" | "badge" | "consumable" | "role";
  rarity: "common" | "rare" | "epic" | "legendary";
  roleId?: string;
  value?: number;
}
export interface Inventory {
  items: Record<string, number>;
  badges: string[];
}
export const dangerousRolePermissions =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers |
  PermissionFlagsBits.ManageEvents;
const cosmeticRolePermissions =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.UseExternalStickers |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.Stream |
  PermissionFlagsBits.UseVAD |
  PermissionFlagsBits.ChangeNickname |
  PermissionFlagsBits.UseApplicationCommands |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.UseSoundboard |
  PermissionFlagsBits.UseExternalSounds |
  PermissionFlagsBits.SendVoiceMessages |
  PermissionFlagsBits.SendPolls |
  PermissionFlagsBits.UseEmbeddedActivities;
export function safeRewardRole(
  role: Role,
  botHighestPosition: number,
): boolean {
  if (
    role.managed ||
    role.id === role.guild.id ||
    role.position >= botHighestPosition ||
    (role.permissions.bitfield & ~cosmeticRolePermissions) !== 0n
  )
    return false;
  // Channel overwrites can grant management powers even when the role's guild bits are safe.
  return !role.guild.channels?.cache.some(
    (channel) =>
      "permissionOverwrites" in channel &&
      ((channel.permissionOverwrites.cache.get(role.id)?.allow.bitfield ?? 0n) &
        ~cosmeticRolePermissions) !==
        0n,
  );
}
export class EconomyService {
  constructor(
    readonly db: Store,
    readonly settings: Settings,
  ) {}
  config(guild: string): EconomyConfig {
    return economyConfigSchema.parse(
      this.settings.moduleConfig(guild, "economy", {}),
    );
  }
  wallet(guild: string, user: string): Wallet {
    return (
      this.db.get<Wallet>(guild, "wallets", user) ?? { balance: 0, claims: {} }
    );
  }
  balance(guild: string, user: string): number {
    return this.wallet(guild, user).balance;
  }
  inventory(guild: string, user: string): Inventory {
    return (
      this.db.get<Inventory>(guild, "inventories", user) ?? {
        items: {},
        badges: [],
      }
    );
  }
  item(guild: string, id: string): ShopItem {
    const item = this.db.get<ShopItem>(guild, "shop", id);
    assert(item, "economy.itemMissing");
    return item;
  }
  private adjust(guild: string, user: string, delta: number): number {
    assert(Number.isSafeInteger(delta), "error.input");
    const wallet = this.wallet(guild, user);
    const balance = wallet.balance + delta;
    assert(
      Number.isSafeInteger(balance) && balance >= 0,
      "economy.insufficient",
    );
    assert(balance <= this.config(guild).maxBalance, "economy.overflow");
    wallet.balance = balance;
    this.db.set(guild, "wallets", user, wallet);
    return balance;
  }
  credit(guild: string, user: string, amount: number, key: string): number {
    assert(Number.isSafeInteger(amount) && amount >= 0, "error.input");
    return this.db.transaction(() => {
      if (this.db.get(guild, "economyLedger", key))
        return this.balance(guild, user);
      const result = this.adjust(guild, user, amount);
      this.db.set(guild, "economyLedger", key, {
        user,
        amount,
        at: Date.now(),
      });
      return result;
    });
  }
  transfer(
    guild: string,
    from: string,
    to: string,
    amount: number,
    key: string,
  ): void {
    assert(from !== to, "economy.self");
    assert(Number.isSafeInteger(amount) && amount > 0, "error.input");
    this.db.transaction(() => {
      if (this.db.get(guild, "economyLedger", key)) return;
      this.adjust(guild, from, -amount);
      this.adjust(guild, to, amount);
      this.db.set(guild, "economyLedger", key, {
        from,
        to,
        amount,
        at: Date.now(),
      });
    });
  }
  claim(
    guild: string,
    user: string,
    kind: "daily" | "weekly" | "work",
    now = Date.now(),
  ): number {
    return this.db.transaction(() => {
      const wallet = this.wallet(guild, user);
      const cfg = this.config(guild);
      const cooldown =
        kind === "daily"
          ? 86_400_000
          : kind === "weekly"
            ? 604_800_000
            : cfg.workCooldown;
      const last = wallet.claims[kind];
      assert(last === undefined || now - last >= cooldown, "error.cooldown", {
        seconds: Math.ceil((cooldown - (now - (last ?? 0))) / 1000),
      });
      const amount = cfg[kind];
      assert(wallet.balance + amount <= cfg.maxBalance, "economy.overflow");
      wallet.balance += amount;
      wallet.claims[kind] = now;
      this.db.set(guild, "wallets", user, wallet);
      return amount;
    });
  }
  buy(guild: string, user: string, id: string, key: string): ShopItem {
    return this.db.transaction(() => {
      const item = this.item(guild, id);
      if (this.db.get(guild, "economyLedger", key)) return item;
      const inventory = this.inventory(guild, user);
      const qty = inventory.items[id] ?? 0;
      assert(qty < 1_000_000, "economy.overflow");
      this.adjust(guild, user, -item.price);
      inventory.items[id] = qty + 1;
      this.db.set(guild, "inventories", user, inventory);
      this.db.set(guild, "economyLedger", key, {
        user,
        buy: id,
        amount: item.price,
        at: Date.now(),
      });
      return item;
    });
  }
  sell(guild: string, user: string, id: string, key: string): number {
    return this.db.transaction(() => {
      const item = this.item(guild, id);
      assert(item.type !== "role", "economy.roleSell");
      const amount = Math.floor(item.price / 2);
      if (this.db.get(guild, "economyLedger", key)) return amount;
      const inventory = this.inventory(guild, user);
      assert((inventory.items[id] ?? 0) > 0, "economy.notOwned");
      inventory.items[id]!--;
      this.adjust(guild, user, amount);
      this.db.set(guild, "inventories", user, inventory);
      this.db.set(guild, "economyLedger", key, {
        user,
        sell: id,
        amount,
        at: Date.now(),
      });
      return amount;
    });
  }
  use(guild: string, user: string, id: string, key: string): ShopItem {
    return this.db.transaction(() => {
      const item = this.item(guild, id);
      if (this.db.get(guild, "economyLedger", key)) return item;
      const inventory = this.inventory(guild, user);
      assert((inventory.items[id] ?? 0) > 0, "economy.notOwned");
      if (item.type === "badge" || item.type === "collectible") {
        if (!inventory.badges.includes(item.name))
          inventory.badges.push(item.name);
      } else {
        inventory.items[id]!--;
        if (item.type === "consumable")
          this.adjust(guild, user, item.value ?? 0);
      }
      this.db.set(guild, "inventories", user, inventory);
      this.db.set(guild, "economyLedger", key, {
        user,
        use: id,
        at: Date.now(),
      });
      return item;
    });
  }
  leaderboard(guild: string): { user: string; balance: number }[] {
    return this.db
      .list<Wallet>(guild, "wallets")
      .map((r) => ({ user: r.key, balance: r.value.balance }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 20);
  }
}
