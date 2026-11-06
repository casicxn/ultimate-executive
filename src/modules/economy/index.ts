import { EmbedBuilder } from "discord.js";
import { z } from "zod";
import type { Command, Module } from "../../core/types.js";
import { registerTranslations, t } from "../../core/localization.js";
import { assert, integer, safeText, userId } from "../../shared.js";
import {
  EconomyService,
  economyConfigSchema,
  safeRewardRole,
  type ShopItem,
} from "./service.js";

registerTranslations({
  "economy.desc.balance": {
    tr: "Cüzdan bakiyesini gösterir.",
    en: "Show a wallet balance.",
  },
  "economy.desc.daily": {
    tr: "Günlük sanal ödülünü al.",
    en: "Claim your daily virtual reward.",
  },
  "economy.desc.weekly": {
    tr: "Haftalık sanal ödülünü al.",
    en: "Claim your weekly virtual reward.",
  },
  "economy.desc.work": {
    tr: "Çalışarak sanal para kazan.",
    en: "Earn virtual coins by working.",
  },
  "economy.desc.pay": {
    tr: "Başka üyeye sanal para gönder.",
    en: "Send virtual coins to another member.",
  },
  "economy.desc.shop": {
    tr: "Mağazayı görüntüle veya yapılandır.",
    en: "View or configure the shop.",
  },
  "economy.desc.buy": {
    tr: "Mağazadan eşya satın al.",
    en: "Buy an item from the shop.",
  },
  "economy.desc.sell": {
    tr: "Eşyayı yarı fiyatına sat.",
    en: "Sell an item for half its price.",
  },
  "economy.desc.inventory": {
    tr: "Envanterini görüntüle.",
    en: "View your inventory.",
  },
  "economy.desc.use": {
    tr: "Envanterindeki eşyayı kullan.",
    en: "Use an inventory item.",
  },
  "economy.desc.economy": {
    tr: "Sanal ekonomi ayarları.",
    en: "Configure the virtual economy.",
  },
  "economy.desc.rich": {
    tr: "Sunucu zenginlik sıralaması.",
    en: "Show the guild wealth leaderboard.",
  },
  "economy.balance": {
    tr: "{user} • {amount} {currency}",
    en: "{user} • {amount} {currency}",
  },
  "economy.reward": {
    tr: "{amount} {currency} kazandın.",
    en: "You earned {amount} {currency}.",
  },
  "economy.paid": {
    tr: "{user} kullanıcısına {amount} {currency} gönderildi.",
    en: "Sent {amount} {currency} to {user}.",
  },
  "economy.insufficient": {
    tr: "Bakiyen bu işlem için yeterli değil.",
    en: "Your balance is insufficient.",
  },
  "economy.overflow": {
    tr: "Bakiye veya envanter sınırına ulaşıldı.",
    en: "The balance or inventory limit was reached.",
  },
  "economy.self": {
    tr: "Kendine ödeme yapamazsın.",
    en: "You cannot pay yourself.",
  },
  "economy.itemMissing": {
    tr: "Bu eşya mağazada bulunamadı.",
    en: "This item was not found in the shop.",
  },
  "economy.notOwned": {
    tr: "Bu eşyaya sahip değilsin.",
    en: "You do not own this item.",
  },
  "economy.roleSell": {
    tr: "Rol ödülleri satılamaz.",
    en: "Role rewards cannot be sold.",
  },
  "economy.roleUnsafe": {
    tr: "Bu rol güvenli bir ödül değil veya botun rolünün üzerinde.",
    en: "This role is unsafe as a reward or is above the bot.",
  },
  "economy.shopTitle": { tr: "Executive Mağaza", en: "Executive Shop" },
  "economy.inventoryTitle": { tr: "Envanter", en: "Inventory" },
  "economy.empty": { tr: "Henüz kayıt yok.", en: "No entries yet." },
  "economy.bought": { tr: "{item} satın alındı.", en: "Purchased {item}." },
  "economy.sold": {
    tr: "Eşya {amount} sanal paraya satıldı.",
    en: "Sold the item for {amount} virtual coins.",
  },
  "economy.used": { tr: "{item} kullanıldı.", en: "Used {item}." },
  "economy.virtual": {
    tr: "Yalnızca sanal para. Gerçek parasal değeri yoktur.",
    en: "Virtual currency only. No real monetary value.",
  },
  "economy.richTitle": {
    tr: "Sanal Ekonomi Sıralaması",
    en: "Virtual Economy Leaderboard",
  },
});

const itemId = z
  .string()
  .regex(/^[a-z0-9_-]{1,32}$/)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
  );
export const economyModule: Module = {
  name: "economy",
  register(runtime) {
    const service = new EconomyService(runtime.db, runtime.settings);
    const add = (
      name: string,
      usage: string,
      execute: Command["execute"],
      aliases?: string[],
    ) =>
      runtime.registry.register({
        name,
        usage,
        module: "economy",
        description: `economy.desc.${name}`,
        aliases,
        execute,
      });
    add(
      "balance",
      ".balance [@user]",
      async (ctx) => {
        const id = ctx.args[0] ? userId(ctx.args[0]) : ctx.user.id;
        await ctx.reply(
          t(ctx.locale, "economy.balance", {
            user: `<@${id}>`,
            amount: service.balance(ctx.guild.id, id),
            currency: service.config(ctx.guild.id).currency,
          }),
        );
      },
      ["bal", "bakiye"],
    );
    for (const kind of ["daily", "weekly", "work"] as const)
      add(kind, `.${kind}`, async (ctx) => {
        const amount = service.claim(ctx.guild.id, ctx.user.id, kind);
        await ctx.reply(
          t(ctx.locale, "economy.reward", {
            amount,
            currency: service.config(ctx.guild.id).currency,
          }),
        );
      });
    add("pay", ".pay @user amount", async (ctx) => {
      const id = userId(ctx.args[0]);
      const target = await ctx.guild.members.fetch(id);
      assert(!target.user.bot, "error.input");
      const amount = integer(ctx.args[1]);
      service.transfer(
        ctx.guild.id,
        ctx.user.id,
        id,
        amount,
        `pay:${ctx.requestId}`,
      );
      await ctx.reply(
        t(ctx.locale, "economy.paid", {
          user: `<@${id}>`,
          amount,
          currency: service.config(ctx.guild.id).currency,
        }),
      );
    });
    add(
      "shop",
      ".shop [add id price type rarity name | role id @role | value id coins | remove id]",
      async (ctx) => {
        const action = ctx.args[0];
        if (action) {
          assert(
            runtime.permissions.canConfigure(ctx.member),
            "error.permission",
          );
          const id = itemId.parse(ctx.args[1]);
          if (action === "add") {
            assert(!runtime.db.get(ctx.guild.id, "shop", id), "error.input");
            const price = integer(ctx.args[2], 1, 1_000_000_000);
            const type = z
              .enum(["collectible", "badge", "consumable", "role"])
              .parse(ctx.args[3]);
            const rarity = z
              .enum(["common", "rare", "epic", "legendary"])
              .parse(ctx.args[4]);
            const name = safeText(ctx.args.slice(5).join(" "), 80);
            assert(name.length > 0, "error.input");
            runtime.db.set<ShopItem>(ctx.guild.id, "shop", id, {
              id,
              name,
              price,
              type,
              rarity,
            });
          } else if (action === "remove") {
            service.item(ctx.guild.id, id);
            runtime.db.delete(ctx.guild.id, "shop", id);
          } else if (action === "role") {
            const item = service.item(ctx.guild.id, id);
            assert(item.type === "role", "error.input");
            const role = await ctx.guild.roles.fetch(userId(ctx.args[2]));
            assert(
              role &&
                safeRewardRole(
                  role,
                  ctx.guild.members.me?.roles.highest.position ?? 0,
                ) &&
                (await runtime.permissions.canAssignPublicRole(role)),
              "economy.roleUnsafe",
            );
            item.roleId = role.id;
            runtime.db.set(ctx.guild.id, "shop", id, item);
          } else if (action === "value") {
            const item = service.item(ctx.guild.id, id);
            assert(item.type === "consumable", "error.input");
            item.value = integer(ctx.args[2], 0, item.price);
            runtime.db.set(ctx.guild.id, "shop", id, item);
          } else assert(false, "error.input");
          await ctx.reply(t(ctx.locale, "common.ok"));
          return;
        }
        const lines = runtime.db
          .list<ShopItem>(ctx.guild.id, "shop")
          .slice(0, 25)
          .map(
            ({ value: i }) =>
              `\`${i.id}\` • ${i.name} • ${i.price} ${service.config(ctx.guild.id).currency} • ${i.rarity}`,
          );
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(t(ctx.locale, "economy.shopTitle"))
              .setDescription(
                lines.join("\n").slice(0, 3900) ||
                  t(ctx.locale, "economy.empty"),
              )
              .setFooter({ text: t(ctx.locale, "economy.virtual") }),
          ],
        });
      },
    );
    add("buy", ".buy item-id", async (ctx) => {
      const id = itemId.parse(ctx.args[0]);
      const item = service.item(ctx.guild.id, id);
      if (item.type === "role") {
        assert(item.roleId, "economy.roleUnsafe");
        const role = await ctx.guild.roles.fetch(item.roleId);
        assert(
          role &&
            safeRewardRole(
              role,
              ctx.guild.members.me?.roles.highest.position ?? 0,
            ) &&
            (await runtime.permissions.canAssignPublicRole(role)),
          "economy.roleUnsafe",
        );
      }
      const result = service.buy(
        ctx.guild.id,
        ctx.user.id,
        id,
        `buy:${ctx.requestId}`,
      );
      await ctx.reply(t(ctx.locale, "economy.bought", { item: result.name }));
    });
    add("sell", ".sell item-id", async (ctx) => {
      const amount = service.sell(
        ctx.guild.id,
        ctx.user.id,
        itemId.parse(ctx.args[0]),
        `sell:${ctx.requestId}`,
      );
      await ctx.reply(t(ctx.locale, "economy.sold", { amount }));
    });
    add(
      "inventory",
      ".inventory",
      async (ctx) => {
        const inv = service.inventory(ctx.guild.id, ctx.user.id);
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(t(ctx.locale, "economy.inventoryTitle"))
              .setDescription(
                Object.entries(inv.items)
                  .filter(([, q]) => q > 0)
                  .slice(0, 25)
                  .map(([id, q]) => `\`${id}\` × ${q}`)
                  .join("\n") || t(ctx.locale, "economy.empty"),
              ),
          ],
        });
      },
      ["envanter"],
    );
    add("use", ".use item-id", async (ctx) => {
      const id = itemId.parse(ctx.args[0]);
      const item = service.item(ctx.guild.id, id);
      if (item.type === "role") {
        assert(item.roleId, "economy.roleUnsafe");
        const role = await ctx.guild.roles.fetch(item.roleId);
        assert(
          role &&
            safeRewardRole(
              role,
              ctx.guild.members.me?.roles.highest.position ?? 0,
            ) &&
            (await runtime.permissions.canAssignPublicRole(role)),
          "economy.roleUnsafe",
        );
        assert(
          (service.inventory(ctx.guild.id, ctx.user.id).items[id] ?? 0) > 0,
          "economy.notOwned",
        );
        // Role addition is idempotent; inventory is consumed only after Discord confirms success.
        await ctx.member.roles.add(
          role,
          `Executive shop; user=${ctx.user.id}; request=${ctx.requestId}`,
        );
      }
      const used = service.use(
        ctx.guild.id,
        ctx.user.id,
        id,
        `use:${ctx.requestId}`,
      );
      await ctx.reply(t(ctx.locale, "economy.used", { item: used.name }));
    });
    add(
      "economy",
      ".economy [set currency|daily|weekly|work|workCooldown|maxBalance value]",
      async (ctx) => {
        assert(
          runtime.permissions.canConfigure(ctx.member),
          "error.permission",
        );
        const cfg = service.config(ctx.guild.id);
        if (ctx.args.length) {
          assert(ctx.args[0] === "set", "error.input");
          const field = z
            .enum([
              "currency",
              "daily",
              "weekly",
              "work",
              "workCooldown",
              "maxBalance",
            ])
            .parse(ctx.args[1]);
          const value =
            field === "currency"
              ? ctx.args.slice(2).join(" ")
              : Number(ctx.args[2]);
          const next = economyConfigSchema.parse({ ...cfg, [field]: value });
          runtime.settings.setModuleConfig(ctx.guild.id, "economy", next);
          await ctx.reply(t(ctx.locale, "common.ok"));
        } else
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("Executive Coins")
                .setDescription(
                  Object.entries(cfg)
                    .map(([k, v]) => `\`${k}\`: ${v}`)
                    .join("\n"),
                )
                .setFooter({ text: t(ctx.locale, "economy.virtual") }),
            ],
          });
      },
    );
    add(
      "rich",
      ".rich",
      async (ctx) => {
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(t(ctx.locale, "economy.richTitle"))
              .setDescription(
                service
                  .leaderboard(ctx.guild.id)
                  .map((r, i) => `${i + 1}. <@${r.user}> • ${r.balance}`)
                  .join("\n") || t(ctx.locale, "economy.empty"),
              ),
          ],
        });
      },
      ["leaderboard"],
    );
  },
};
