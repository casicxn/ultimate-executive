import { createHash } from "node:crypto";
import type { Store } from "../../database/store.js";
import { UserError } from "../../shared.js";
export type CaseStatus = "pending" | "succeeded" | "failed" | "uncertain";
export interface ModerationCase {
  id: string;
  guild: string;
  moderator: string;
  target: string;
  action: string;
  reason: string;
  created: number;
  status: CaseStatus;
  requestId: string;
  duration?: number;
  expires?: number;
  result?: string;
  reversedAt?: number;
  reversedBy?: string;
  reversalCase?: string;
}
export class CaseRepository {
  constructor(readonly db: Store) {}
  begin(
    input: Omit<ModerationCase, "id" | "created" | "status">,
  ): ModerationCase {
    return this.db.transaction(() => {
      const requestKey = createHash("sha256")
        .update(`${input.requestId}:${input.action}`)
        .digest("hex");
      const prior = this.db.get<string>(
        input.guild,
        "caseRequests",
        requestKey,
      );
      if (prior) {
        const record = this.get(input.guild, prior);
        throw new UserError("mod.duplicate", {
          id: prior,
          status: record?.status ?? "pending",
        });
      }
      const sequence =
        (this.db.get<number>(input.guild, "moderation", "sequence") ?? 0) + 1;
      this.db.set(input.guild, "moderation", "sequence", sequence);
      const record: ModerationCase = {
        ...input,
        id: String(sequence),
        created: Date.now(),
        status: "pending",
      };
      this.db.set(input.guild, "cases", record.id, record);
      this.db.set(input.guild, "caseRequests", requestKey, record.id);
      return record;
    });
  }
  get(guild: string, id: string): ModerationCase | undefined {
    return this.db.get(guild, "cases", id);
  }
  finish(
    record: ModerationCase,
    status: CaseStatus,
    result?: string,
  ): ModerationCase {
    const next = {
      ...record,
      ...this.get(record.guild, record.id),
      status,
      result,
    };
    this.db.set(record.guild, "cases", record.id, next);
    return next;
  }
  reverse(guild: string, id: string, by: string, reversalCase: string): void {
    const record = this.get(guild, id);
    if (record)
      this.db.set(guild, "cases", id, {
        ...record,
        reversedAt: Date.now(),
        reversedBy: by,
        reversalCase,
      });
  }
  list(guild: string, target?: string): ModerationCase[] {
    return this.db
      .list<ModerationCase>(guild, "cases")
      .map((r) => r.value)
      .filter((r) => !target || r.target === target)
      .sort((a, b) => b.created - a.created || Number(b.id) - Number(a.id));
  }
  auditReason(record: ModerationCase): string {
    return `Executive case=${record.id} moderator=${record.moderator} | ${record.reason}`.slice(
      0,
      512,
    );
  }
}
