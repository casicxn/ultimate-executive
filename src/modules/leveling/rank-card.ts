import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { levelProgress } from "./service.js";
import { t, type Locale } from "../../core/localization.js";
const avatars = new Map<string, { image: Image; expires: number }>();
export interface RankCardOptions {
  username: string;
  avatar: string;
  xp: number;
  rank: number;
  accent: string;
  background: string;
  locale: Locale;
}
async function avatarImage(url: string): Promise<Image | undefined> {
  const cached = avatars.get(url);
  if (cached && cached.expires > Date.now()) return cached.image;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !["cdn.discordapp.com", "media.discordapp.net"].includes(parsed.hostname)
    )
      return;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 2_000_000) return;
    const image = await loadImage(bytes);
    if (avatars.size >= 200) avatars.delete(avatars.keys().next().value!);
    avatars.set(url, { image, expires: Date.now() + 3600000 });
    return image;
  } catch {
    return;
  }
}
export async function renderRankCard(
  options: RankCardOptions,
): Promise<Buffer> {
  const canvas = createCanvas(900, 280);
  const ctx = canvas.getContext("2d");
  const p = levelProgress(options.xp);
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, 900, 280);
  const gradient = ctx.createLinearGradient(0, 0, 900, 280);
  gradient.addColorStop(0, `${options.accent}55`);
  gradient.addColorStop(1, "#00000000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 280);
  ctx.fillStyle = options.accent;
  ctx.fillRect(0, 0, 8, 280);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("EXECUTIVE", 42, 42);
  ctx.fillStyle = "#aeb8cc";
  ctx.font = "14px sans-serif";
  ctx.fillText(t(options.locale, "branding"), 42, 253);
  const avatar = await avatarImage(options.avatar);
  ctx.save();
  ctx.beginPath();
  ctx.arc(124, 137, 67, 0, 2 * Math.PI);
  ctx.clip();
  ctx.fillStyle = options.accent;
  ctx.fillRect(57, 70, 134, 134);
  if (avatar) ctx.drawImage(avatar, 57, 70, 134, 134);
  else {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 50px sans-serif";
    ctx.fillText(options.username.slice(0, 1).toUpperCase(), 103, 155);
  }
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px sans-serif";
  let name = options.username;
  while (ctx.measureText(name).width > 575 && name.length > 1)
    name = name.slice(0, -1);
  ctx.fillText(name, 226, 103);
  ctx.fillStyle = "#c6cddd";
  ctx.font = "20px sans-serif";
  ctx.fillText(
    `${t(options.locale, "leveling.level")} ${p.level}     ${t(options.locale, "leveling.rank")} #${options.rank || "—"}`,
    226,
    142,
  );
  ctx.fillStyle = "#263246";
  ctx.beginPath();
  ctx.roundRect(226, 168, 610, 22, 11);
  ctx.fill();
  if (p.fraction > 0) {
    ctx.fillStyle = options.accent;
    ctx.beginPath();
    ctx.roundRect(226, 168, Math.max(22, 610 * p.fraction), 22, 11);
    ctx.fill();
  }
  ctx.fillStyle = "#c6cddd";
  ctx.font = "16px sans-serif";
  ctx.fillText(
    `${p.current.toLocaleString(options.locale)} / ${p.needed.toLocaleString(options.locale)} XP`,
    226,
    218,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "#7f90aa";
  ctx.fillText(`${options.xp.toLocaleString(options.locale)} XP`, 836, 218);
  return canvas.toBuffer("image/png");
}
