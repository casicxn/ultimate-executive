import type { Runtime } from "../../core/types.js";
import { assert } from "../../shared.js";
const day = 86400000;
const completed: Record<string, readonly string[]> = {
  gameSessions: ["won", "lost", "draw", "rejected", "expired"],
  proposals: ["accepted", "rejected", "expired"],
  reminders: ["sent", "cancelled", "failed"],
  giveaways: ["ended"],
  polls: ["ended"],
  events: ["started", "cancelled"],
  tickets: ["closed", "failed"],
  suggestions: ["approve", "reject"],
};
const expiring = ["cooldowns", "actionLimits", "autoCooldown", "afkNotices"];

/** Deletes terminal metadata only. Wallets, permissions, cases, and replay ledgers are never candidates. */
export function cleanupGuild(
  runtime: Runtime,
  guild: string,
  days: number,
  now = Date.now(),
): number {
  assert(Number.isInteger(days) && days >= 30 && days <= 3650);
  return runtime.db.transaction(() => {
    const outstanding = new Set(
      runtime.db
        .list<{ payload?: { id?: unknown } }>(guild, "jobs")
        .map((j) => j.value.payload?.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const namespaces = [...expiring, ...Object.keys(completed)];
    const candidates = runtime.db.sqlite
      .prepare(
        `SELECT namespace,key,value FROM records WHERE guild=? AND updated<? AND namespace IN (${namespaces.map(() => "?").join(",")})`,
      )
      .all(guild, now - days * day, ...namespaces) as {
      namespace: string;
      key: string;
      value: string;
    }[];
    let count = 0;
    for (const row of candidates) {
      const value: unknown = JSON.parse(row.value);
      let eligible = false;
      if (expiring.includes(row.namespace)) {
        if (row.namespace === "actionLimits")
          eligible =
            typeof value === "object" &&
            value !== null &&
            "start" in value &&
            typeof value.start === "number" &&
            value.start + 60000 <= now;
        else
          eligible =
            typeof value === "number" &&
            Number.isFinite(value) &&
            value + (row.namespace === "afkNotices" ? 60000 : 0) <= now;
      } else if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>,
          status = row.namespace === "tickets" ? record.state : record.status;
        eligible =
          typeof status === "string" &&
          completed[row.namespace]!.includes(status) &&
          !outstanding.has(row.key);
        // A game with an unprocessed human reward remains recoverable even after the retention threshold.
        if (
          row.namespace === "gameSessions" &&
          status === "won" &&
          record.winner !== "bot" &&
          record.rewarded !== true
        )
          eligible = false;
      }
      if (!eligible) continue;
      runtime.db.delete(guild, row.namespace, row.key);
      count++;
      if (row.namespace === "tickets") {
        const record = value as { channel?: string; owner?: string };
        if (
          record.channel &&
          runtime.db.get(guild, "ticketChannels", record.channel) === row.key
        ) {
          runtime.db.delete(guild, "ticketChannels", record.channel);
          count++;
        }
        if (
          record.owner &&
          runtime.db.get(guild, "ticketActive", record.owner) === row.key
        ) {
          runtime.db.delete(guild, "ticketActive", record.owner);
          count++;
        }
      }
    }
    return count;
  });
}
export function scheduleRetention(
  runtime: Runtime,
  guild: string,
  now = Date.now(),
  runningJob?: string,
): void {
  if (
    runtime.db
      .list<{ id: string; type: string }>(guild, "jobs")
      .some(
        (j) => j.value.type === "utilities.retention" && j.key !== runningJob,
      )
  )
    return;
  const due = now + day;
  runtime.scheduler.schedule(
    guild,
    "utilities",
    "utilities.retention",
    due,
    {},
    `retention:${due}`,
  );
}
