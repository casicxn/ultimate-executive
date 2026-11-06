# Türkçe kurulum

## Gereksinimler

- Node.js 24 LTS, pnpm 10.10.0.
- Discord Developer Portal'da kendinize ait bir uygulama ve bot.
- Test sunucusunda bot ekleme ve rol sıralaması düzenleme hakkı.

Standart Node kurulumundan sonra `npm install -g pnpm@10.10.0`, proje klasöründe `pnpm install` çalıştırın. SQLite ve PNG üretimi yerel paketlerle sağlanır. Hazır yerel paket bulunamayan platformlarda SQLite için Python ve C++ derleme araçları gerekebilir.

`.env.example` dosyasını `.env` adıyla kopyalayın:

| Değer | Anlam |
|---|---|
| DISCORD_TOKEN | Developer Portal → Bot → token; gizli tutulmalı |
| APPLICATION_ID | Developer Portal → General Information → application ID |
| BOT_OWNER_ID | Global uygulama yönetimi için kendi Discord kullanıcı ID'niz |
| DEV_GUILD_ID | İsteğe bağlı test sunucusu ID; slash kayıtlarını yalnız buraya yapar |
| DATABASE_PATH | Varsayılan `./data/executive.sqlite` |
| LOG_LEVEL | `info`; gerekirse `debug`, `warn`, `error` |

Discord istemcisinde Geliştirici Modu ID kopyalamayı sağlar. Hiçbir token kaynak dosyaya yazılmaz veya iki bot arasında paylaşılmaz.

## Intent ve izinler

Developer Portal → Bot → Privileged Gateway Intents bölümünde **Message Content Intent** ve **Server Members Intent** açılmalı. Önek komutları mesaj içeriği olmadan çalışamaz. Büyük/halka açık kurulumlarda Discord bu intent'ler için ayrıca onay isteyebilir. Kod Guilds, GuildMembers, GuildMessages, MessageContent ve GuildVoiceStates intent'lerini kullanır; presence intent gerekmez.

OAuth2 kurulumunda `bot` ve `applications.commands` kapsamlarını seçin. Administrator vermek zorunlu değildir:

| İşlev | Botun ihtiyacı |
|---|---|
| Komut ve panel | View Channels, Send Messages, Embed Links, Read Message History |
| Rank kartı/döküm | Attach Files |
| Ban/kick/timeout | Ban Members / Kick Members / Moderate Members |
| Mesaj silme | Manage Messages |
| Karantina/rol ödülleri | Manage Roles |
| Kilit/slowmode/destek kanalları | Manage Channels; overwrite düzenleme için Manage Roles |
| Nick | Manage Nicknames |

Bot rolünü yöneteceği üye ve rollerin üzerinde konumlandırın. Personel ve korumalı rolleri herkese açık ödül rollerinin üzerinde tutun. Personelin kendisine aynı yerel izinleri vermeniz gerekmez: `.staff grant role ID warn mute sil` yeterlidir; bot ve gerçek insan moderatör hiyerarşisi ayrıca denetlenir.

## Çalıştırma

```text
pnpm register
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

`pnpm register`, uygulamanın kayıtlı slash komutlarını `/executive` tanımıyla günceller. Bu bot uygulamasını başka projeyle paylaşmayın. `DEV_GUILD_ID` test kaydı sağlar; boş bırakıldığında global kayıt yapılır ve Discord dağıtımı zaman alabilir.

Geliştirme: `pnpm dev`. Yönetim: sunucu sahibi `.panel` veya `/executive panel`. Ayrıntılı ayarlar: [CONFIGURATION.md](CONFIGURATION.md).

## Docker ve yedek

`docker compose up -d --build` botu ayrı süreçte çalıştırır. `docker compose logs -f` kayıtları izler. `docker compose down` veritabanı birimini korur; birimi silmeyin. Docker çalıştırma bu teslimatta test edilmemiştir.

Dosya kurulumunda botu durdurduktan sonra `data/` klasörünü güvenli yere kopyalayın. Çalışırken yalnız `.sqlite` dosyasını kopyalamak WAL nedeniyle tutarsız yedek üretebilir. `pnpm start` mevcut veritabanını silmez; geçişler açılışta transaction içinde uygulanır.

## İlk kabul testi

Kontrollü sunucuda `.help`, `.daily`, `.rank`, `.quiz`, `.xox @testüyesi`, `.ticket` ve `.giveaway` akışlarını deneyin. Yetkisiz bir hesabın `.ban`, `.staff`, panel değiştirme ve başkasının oyun düğmesine erişemediğini kontrol edin. Botu yeniden başlatıp panel ve planlı işlerin devam ettiğini doğrulayın. Üretim sunucusunda toplu silme veya ceza testleri yapmayın.
