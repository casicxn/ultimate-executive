import { z } from "zod";
export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(20),
  APPLICATION_ID: z.string().regex(/^\d{17,20}$/),
  BOT_OWNER_ID: z.string().regex(/^\d{17,20}$/),
  DEV_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional()
    .or(z.literal("")),
  DATABASE_PATH: z.string().default("./data/executive.sqlite"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});
