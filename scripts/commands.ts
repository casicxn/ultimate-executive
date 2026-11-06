import { writeFileSync, mkdirSync } from "node:fs";
import { createRuntime, registerModules } from "../src/core/runtime.js";
import { modules } from "../src/modules/index.js";
import { DEVELOPER_CREDIT, t } from "../src/core/localization.js";
const r = createRuntime(":memory:", "");
registerModules(r, modules);
mkdirSync("docs", { recursive: true });
const lines = [
  "# Komutlar / Commands",
  "",
  `**${DEVELOPER_CREDIT}**`,
  "",
  "Komutları `/executive run` ile de çalıştırabilirsiniz. Dil seçimi için `/executive language` menüsünü kullanın.",
  "",
  "| Komut | Takma adlar | Modül | Yetki | Türkçe | English |",
  "|---|---|---|---|---|---|",
  ...r.registry
    .all()
    .map(
      (c) =>
        `| ${c.usage.replaceAll("|", "\\|")} | ${(c.aliases ?? []).join(", ")} | ${c.module} | ${c.permission ?? "—"} | ${t("tr", c.description)} | ${t("en", c.description)} |`,
    ),
];
writeFileSync("docs/COMMANDS.md", lines.join("\n") + "\n");
console.log(`${r.registry.all().length} komut belgelendi.`);
await r.client.destroy();
r.db.close();
