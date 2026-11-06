import { writeFileSync, mkdirSync } from "node:fs";
import { renderRankCard } from "../src/modules/leveling/rank-card.js";
import "../src/modules/leveling/index.js";
mkdirSync("docs", { recursive: true });
const image = await renderRankCard({
  username: "Casi",
  avatar: "",
  xp: 20482,
  rank: 3,
  accent: "#7989ff",
  background: "#101827",
  locale: "tr",
});
writeFileSync("docs/rank-preview.png", image);
console.log("Rank kartı örneği docs/rank-preview.png dosyasına kaydedildi.");
