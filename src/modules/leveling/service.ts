import { z } from "zod";
import type { Store } from "../../database/store.js";
import type { Settings } from "../../core/settings.js";
import { assert } from "../../shared.js";
export const levelingConfigSchema = z.object({
  messageXp: z.number().int().min(0).max(1000).default(15),
  messageCooldown: z.number().int().min(15000).max(3600000).default(60000),
  voiceXp: z.number().int().min(0).max(1000).default(10),
  voiceInterval: z.number().int().min(60000).max(3600000).default(60000),
  multiplier: z.number().min(0).max(10).default(1),
  excludedChannels: z.array(z.string()).default([]),
  excludedRoles: z.array(z.string()).default([]),
  rewardRoles: z.record(z.string(), z.string()).default({}),
  notifyChannel: z.string().optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#5865f2"),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#111827"),
});
export interface LevelProfile {
  xp: number;
  messages: number;
  voiceTicks: number;
}
export function levelFor(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100));
}
export function levelProgress(xp: number): {
  level: number;
  current: number;
  needed: number;
  fraction: number;
} {
  const level = levelFor(xp);
  const base = level * level * 100;
  const next = (level + 1) * (level + 1) * 100;
  return {
    level,
    current: xp - base,
    needed: next - base,
    fraction: (xp - base) / (next - base),
  };
}
interface Activity {
  next: number;
  hashes: { hash: string; at: number }[];
}
export class LevelingService {
  constructor(
    readonly db: Store,
    readonly settings: Settings,
  ) {}
  config(guild: string) {
    return levelingConfigSchema.parse(
      this.settings.moduleConfig(guild, "leveling", {}),
    );
  }
  profile(guild: string, user: string): LevelProfile {
    return (
      this.db.get<LevelProfile>(guild, "levels", user) ?? {
        xp: 0,
        messages: 0,
        voiceTicks: 0,
      }
    );
  }
  award(guild: string, user: string, xp: number, key: string): LevelProfile {
    assert(Number.isSafeInteger(xp) && xp >= 0, "error.input");
    return this.db.transaction(() => {
      const p = this.profile(guild, user);
      if (this.db.get(guild, "xpLedger", key)) return p;
      assert(
        Number.isSafeInteger(p.xp + xp) && p.xp + xp <= 1e12,
        "leveling.overflow",
      );
      p.xp += xp;
      this.db.set(guild, "levels", user, p);
      this.db.set(guild, "xpLedger", key, { user, xp, at: Date.now() });
      return p;
    });
  }
  message(
    guild: string,
    user: string,
    hash: string,
    messageId: string,
    now = Date.now(),
  ): LevelProfile | undefined {
    return this.db.transaction(() => {
      if (this.db.get(guild, "xpLedger", `message:${messageId}`)) return;
      const cfg = this.config(guild);
      const a = this.db.get<Activity>(guild, "xpActivity", user) ?? {
        next: 0,
        hashes: [],
      };
      if (
        a.next > now ||
        a.hashes.some((r) => r.hash === hash && now - r.at < 86400000)
      )
        return;
      a.next = now + cfg.messageCooldown;
      a.hashes = [
        ...a.hashes.filter((r) => now - r.at < 86400000),
        { hash, at: now },
      ].slice(-20);
      this.db.set(guild, "xpActivity", user, a);
      const p = this.award(
        guild,
        user,
        Math.floor(cfg.messageXp * cfg.multiplier),
        `message:${messageId}`,
      );
      p.messages++;
      this.db.set(guild, "levels", user, p);
      return p;
    });
  }
  voice(guild: string, user: string, key: string): LevelProfile {
    return this.db.transaction(() => {
      if (this.db.get(guild, "xpLedger", key)) return this.profile(guild, user);
      const cfg = this.config(guild);
      const p = this.award(
        guild,
        user,
        Math.floor(cfg.voiceXp * cfg.multiplier),
        key,
      );
      p.voiceTicks++;
      this.db.set(guild, "levels", user, p);
      return p;
    });
  }
  leaderboard(guild: string): { user: string; xp: number; level: number }[] {
    return this.db
      .list<LevelProfile>(guild, "levels")
      .map((r) => ({
        user: r.key,
        xp: r.value.xp,
        level: levelFor(r.value.xp),
      }))
      .sort((a, b) => b.xp - a.xp);
  }
}
