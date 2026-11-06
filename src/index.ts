import { ActivityType, Events } from "discord.js";
import { DEVELOPER_CREDIT } from "./core/localization.js";
import { envSchema } from "./configuration/env.js";
import { createRuntime, registerModules } from "./core/runtime.js";
import { attachRouter } from "./core/router.js";
import { modules } from "./modules/index.js";
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Yapılandırma eksik veya geçersiz / Missing or invalid configuration:",
    parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
  );
  process.exit(1);
}
const env = parsed.data;
const runtime = createRuntime(
  env.DATABASE_PATH,
  env.BOT_OWNER_ID,
  env.LOG_LEVEL,
);
registerModules(runtime, modules);
const drainRouter = attachRouter(runtime);
runtime.client.once(Events.ClientReady, (client) => {
  client.user.setActivity(DEVELOPER_CREDIT, {
    type: ActivityType.Custom,
    state: DEVELOPER_CREDIT,
  });
  runtime.logger.info(
    {
      bot: client.user.id,
      commands: runtime.registry.all().length,
      guilds: client.guilds.cache.size,
    },
    `Ultimate Executive ready · ${DEVELOPER_CREDIT}`,
  );
  runtime.scheduler.start();
  void runtime.scheduler
    .tick()
    .catch((err) =>
      runtime.logger.error({ err }, "Initial scheduler tick failed"),
    );
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  runtime.scheduler.stop();
  await drainRouter();
  await runtime.scheduler.drain();
  await runtime.client.destroy();
  runtime.db.close();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
await runtime.client.login(env.DISCORD_TOKEN).catch(async (error) => {
  runtime.logger.fatal({ err: error }, "Discord login failed");
  await shutdown();
  process.exitCode = 1;
});
