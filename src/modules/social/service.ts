import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../../database/store.js";
import type { Settings } from "../../core/settings.js";
import { assert } from "../../shared.js";
export const socialConfigSchema = z.object({
  repCooldown: z.number().int().min(3600000).max(604800000).default(86400000),
  marriageEnabled: z.boolean().default(true),
  birthdayChannel: z.string().optional(),
});
export interface SocialProfile {
  bio: string;
  rep: number;
  birthday?: { day: number; month: number };
}
export interface Proposal {
  id: string;
  from: string;
  to: string;
  expires: number;
  status: "pending" | "accepted" | "rejected" | "expired";
}
export interface Marriage {
  partner: string;
  since: number;
  proposal: string;
}
export interface Reminder {
  id: string;
  user: string;
  text: string;
  due: number;
  status: "pending" | "sent" | "cancelled" | "failed" | "sending";
  channel: string;
}
export class SocialService {
  constructor(
    readonly db: Store,
    readonly settings: Settings,
  ) {}
  config(guild: string) {
    return socialConfigSchema.parse(
      this.settings.moduleConfig(guild, "social", {}),
    );
  }
  profile(guild: string, user: string): SocialProfile {
    return (
      this.db.get<SocialProfile>(guild, "profiles", user) ?? { bio: "", rep: 0 }
    );
  }
  partner(guild: string, user: string): Marriage | undefined {
    return this.db.get<Marriage>(guild, "marriages", user);
  }
  reputation(
    guild: string,
    from: string,
    to: string,
    key: string,
    now = Date.now(),
  ): number {
    assert(from !== to, "social.repSelf");
    return this.db.transaction(() => {
      const p = this.profile(guild, to);
      if (this.db.get(guild, "repLedger", key)) return p.rep;
      const next = this.db.get<number>(guild, "repCooldowns", from) ?? 0;
      assert(now >= next, "error.cooldown", {
        seconds: Math.ceil((next - now) / 1000),
      });
      assert(p.rep < Number.MAX_SAFE_INTEGER, "error.input");
      p.rep++;
      this.db.set(guild, "profiles", to, p);
      this.db.set(
        guild,
        "repCooldowns",
        from,
        now + this.config(guild).repCooldown,
      );
      this.db.set(guild, "repLedger", key, { from, to, at: now });
      return p.rep;
    });
  }
  propose(guild: string, from: string, to: string, now = Date.now()): Proposal {
    assert(from !== to, "social.self");
    assert(this.config(guild).marriageEnabled, "error.disabled");
    return this.db.transaction(() => {
      assert(
        !this.partner(guild, from) && !this.partner(guild, to),
        "social.alreadyMarried",
      );
      const active = this.db
        .list<Proposal>(guild, "proposals")
        .some(
          (r) =>
            r.value.status === "pending" &&
            r.value.expires > now &&
            (r.value.from === from ||
              r.value.to === from ||
              r.value.from === to ||
              r.value.to === to),
        );
      assert(!active, "social.pending");
      const p: Proposal = {
        id: randomUUID(),
        from,
        to,
        expires: now + 120000,
        status: "pending",
      };
      this.db.set(guild, "proposals", p.id, p);
      return p;
    });
  }
  answer(
    guild: string,
    id: string,
    actor: string,
    accept: boolean,
    now = Date.now(),
  ): Proposal {
    return this.db.transaction(() => {
      const p = this.db.get<Proposal>(guild, "proposals", id);
      assert(p, "error.expired");
      assert(p.to === actor, "error.permission");
      assert(p.status === "pending" && p.expires > now, "error.expired");
      assert(this.config(guild).marriageEnabled, "error.disabled");
      if (accept) {
        assert(
          !this.partner(guild, p.from) && !this.partner(guild, p.to),
          "social.alreadyMarried",
        );
        this.db.set<Marriage>(guild, "marriages", p.from, {
          partner: p.to,
          since: now,
          proposal: id,
        });
        this.db.set<Marriage>(guild, "marriages", p.to, {
          partner: p.from,
          since: now,
          proposal: id,
        });
        p.status = "accepted";
      } else p.status = "rejected";
      this.db.set(guild, "proposals", id, p);
      return p;
    });
  }
  divorce(guild: string, user: string): void {
    this.db.transaction(() => {
      const m = this.partner(guild, user);
      assert(m, "social.notMarried");
      const reciprocal = this.partner(guild, m.partner);
      this.db.delete(guild, "marriages", user);
      if (reciprocal?.partner === user)
        this.db.delete(guild, "marriages", m.partner);
    });
  }
}
export function parseBirthday(value: string): { day: number; month: number } {
  const match = /^(\d{2})[-/.](\d{2})$/.exec(value);
  assert(match);
  const day = Number(match[1]),
    month = Number(match[2]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  assert(date.getUTCDate() === day && date.getUTCMonth() === month - 1);
  return { day, month };
}
export function nextBirthday(
  day: number,
  month: number,
  now = Date.now(),
): number {
  const date = new Date(now);
  let year = date.getUTCFullYear();
  let result = Date.UTC(year, month - 1, day, 9);
  while (result <= now || new Date(result).getUTCMonth() !== month - 1) {
    year++;
    result = Date.UTC(year, month - 1, day, 9);
  }
  return result;
}
