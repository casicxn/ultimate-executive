import { z } from "zod";
export class UserError extends Error {
  constructor(
    readonly key: string,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(key);
  }
}
export function assert(
  condition: unknown,
  key = "error.input",
  vars: Record<string, string | number> = {},
): asserts condition {
  if (!condition) throw new UserError(key, vars);
}
export const snowflake = z.string().regex(/^\d{17,20}$/);
export function userId(value: string | undefined): string {
  return snowflake.parse(value?.replace(/[<@!>&#>]/g, ""));
}
export function integer(
  value: string | undefined,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  return z.coerce.number().int().min(min).max(max).parse(value);
}
export function duration(
  value: string | undefined,
  max = 365 * 86400000,
): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(value ?? "");
  assert(match);
  const result =
    Number(match[1]) *
    ({ s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2]!] ??
      0);
  assert(Number.isSafeInteger(result) && result > 0 && result <= max);
  return result;
}
export function safeText(value: string, max = 1500): string {
  return value.replace(/@/g, "＠").slice(0, max);
}
