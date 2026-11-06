import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { envSchema } from "../src/configuration/env.js";
import { DEVELOPER_CREDIT } from "../src/core/localization.js";
const env = envSchema.parse(process.env);
const command = new SlashCommandBuilder()
  .setName("executive")
  .setDescription(`Ultimate Executive · ${DEVELOPER_CREDIT}`)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName("panel").setDescription("Yönetim paneli / Control panel"),
  )
  .addSubcommand((s) =>
    s
      .setName("language")
      .setDescription("Set the server language")
      .setDescriptionLocalization("tr", "Sunucu dilini seç")
      .addStringOption((o) =>
        o
          .setName("locale")
          .setDescription("Server language")
          .setDescriptionLocalization("tr", "Sunucu dili")
          .setRequired(true)
          .addChoices(
            { name: "Türkçe", value: "tr" },
            { name: "English", value: "en" },
          ),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("run")
      .setDescription("Komut çalıştır / Run a command")
      .addStringOption((o) =>
        o
          .setName("command")
          .setDescription("Komut adı / Command name")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("arguments").setDescription("Argümanlar / Arguments"),
      ),
  );
const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
const route = env.DEV_GUILD_ID
  ? Routes.applicationGuildCommands(env.APPLICATION_ID, env.DEV_GUILD_ID)
  : Routes.applicationCommands(env.APPLICATION_ID);
await rest.put(route, { body: [command.toJSON()] });
console.log("Executive komutları kaydedildi.");
