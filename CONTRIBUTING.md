# Katkı / Contributing

Node.js 24 LTS ve pnpm 10.10.0 kullanın. `pnpm install` ardından `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` çalıştırın.
Yeni modüller `src/core/types.ts` içindeki `Module` arayüzünü ve merkezi komut kaydını kullanmalı. Sunucu verilerini sunucu kimliğine göre ayırın ve SQLite işlemlerini eşzamanlı yürütün.
Yeni UI metinleri hem tr hem en içermeli. Güvenlik değişiklikleri sunucu izolasyonu, hiyerarşi ve yeniden başlatma testlerini kapsamalı.
Bot token'ı veya kullanıcıya ait özel kayıtları issue/PR içine eklemeyin. Gerçek Discord sunucusu testi yalnız kontrollü test sunucusunda yapılmalı.

Use Node.js 24 LTS and pnpm 10.10.0. Run the four checks above before proposing a change. Add both Turkish and English translations, register commands centrally, and test persistence and guild isolation. Never attach secrets or production member records.
