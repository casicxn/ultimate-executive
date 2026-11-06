# Yapılandırma / Configuration

Tüm sunucu ayarları Discord içinden yapılır. `BOT_OWNER_ID` global uygulama sahibidir; başka bir sunucunun ayarlarını otomatik yönetme hakkı vermez. Sunucu sahibi kendi sunucusunu yönetir ve `.staff admin USER_ID` ile açıkça yapılandırma yöneticisi atayabilir. Yalnız sunucu sahibi bu delegasyonu değiştirebilir. Discord Administrator yetkisi tek başına yapılandırma yönetimi anlamına gelmez.

All guild configuration is available inside Discord. The application owner controls bot-wide administration, not arbitrary guild settings. The guild owner and explicitly delegated configuration managers control that guild. Only the guild owner may change the delegation. Native Discord Administrator alone does not grant configuration access.

## Panel

`.panel` ve `/executive panel` aynı arayüzü açar. Bölüm seçimi mevcut mesajı düzenler; düğme/seçici/modal kimlikleri süreçteki geçici collector'lara bağlı değildir ve yeniden başlatma sonrasında yönlendirilir. Her tıklamada sunucu ve yetki yeniden kontrol edilir. Dil seçimi tr/en kaydeder. Bölüm listesi moderasyon, personel, oyun, ekonomi, seviye, sosyal, çekiliş, destek, karşılama, araçlar, istatistikler, kayıt, dil ve sistem durumunu içerir.

Panelde modül açma/kapama ve sık kullanılan sayısal ayarlar bulunur. Kanal seçicileri karşılama veya kayıt kanalı ayarlar. Karşılama rol seçicisi güvenli otomatik rolü, personel kullanıcı seçicisi yapılandırma yöneticilerini belirler. Ayrıntılı yetkiler `.staff`, mağaza `.shop`, XP `.xp`, karantina `.jailsetup` ve destek `.ticket setup` ile yönetilir.

`.panel` and `/executive panel` share one persistent interface. Navigation edits the existing message. The panel exposes module switches, common numeric settings, language, logging/welcome channels, welcome roles, delegated users, and health. More detailed configuration uses the commands below. Controls remain usable after restart; every action rechecks authorization.

## Sunucu komutları / Guild controls

```text
.config list
.dil tr
.language en
.config language tr
.config language en
.config module economy off
.config module economy on
.config command coinflip off
.config command yazitura on
.config social repCooldown 86400000
.config social marriageEnabled on
.config social birthdayChannel CHANNEL_ID
.config giveaways maxEntries 1000
.config giveaways changeVotes off
.config entertainment sessionMs 300000
.config utilities suggestionThreads on
```

Sunucu sahibi veya yapılandırma yöneticisi `/executive language` menüsünde Türkçe ya da İngilizceyi seçebilir. `.dil` mevcut seçimi gösterir.

The guild owner or a configuration manager can choose Turkish or English in the `/executive language` menu. Run `.language` to see the current setting.

Takma adlar asıl komut adına çözülür. Komut/modül kapatma veriyi silmez. `.config` ve `.panel` kurtarma yolu olarak kapatılamaz. Modül kapalıyken zamanlanmış işler bekler; yeniden açılınca zamanı geçen işler işlenir. `maxEntries` 2–100000 aralığında, anket oy değiştirme ayarı yeni anketlere uygulanır. Oyun süresi 30000–3600000 ms.

Aliases resolve to their canonical commands. Disabling preserves data. Module disabling also pauses interactions, hooks, and scheduled jobs. Expired work is processed when re-enabled. Poll vote-change settings apply when a poll is created. The entry limit is 2–100000; large giveaways perform more member validations and are subject to Discord rate limits. Game session duration is 30000–3600000 ms.

## Personel / Staff

```text
.staff grant role ROLE_ID kick mute sil warn
.staff grant user USER_ID warn
.staff revoke role ROLE_ID kick
.staff group support warn sil
.staff assign role ROLE_ID support
.staff unassign role ROLE_ID support
.staff protect user USER_ID
.staff protect role ROLE_ID
.staff unprotect role ROLE_ID
.staff limit 10
.staff admin USER_ID
.staff unadmin USER_ID
.staff list
```

İşlem limitleri kişi ve işlem türü başına dakikadır. Merkezi komut yönlendirmesi ayrıca kullanıcı beklemesi ve sunucu hız sınırı uygular. Komut yetkisi serbest Discord API çalıştırma hakkı değildir. Hedefin rol sırası hem gerçek moderatörün hem botun altında olmalı; sunucu sahibi, korumalı hedefler ve bot kendisi için ek kontroller vardır.

Publicly obtainable roles are checked at configuration and at assignment. Native/channel management permissions, Executive role grants, ticket support roles, protected roles, and roles at or above staff hierarchy are rejected. User-specific staff grants and delegated configuration managers also constrain reward hierarchy. Put cosmetic/self/reward roles below staff roles. A failed staff lookup prevents assignment rather than bypassing the check.

## Karantina / Jail

```text
.jailsetup JAIL_ROLE_ID JAIL_CHANNEL_ID OPTIONAL_REMOVED_ROLE_ID...
.jail @user 1h reason
.unjail @user reason
```

Kurulum mevcut kanallarda karantina rolünün görüntüleme/yazma izinlerini düzenler. Bunu önceden bir test sunucusunda kontrol edin. Yeni kanaldan sonra kurulumu tekrar çalıştırın. Kullanıcının tüm rolleri değiştirilmez; yalnız açıkça listelenen güvenli roller geçici kaldırılır ve izinleri değişmemişse iade edilir. Saklanan roller güçlü yetki kazanmışsa geri verilmez. Karantinayı aşan üye/rol overwrite varsa işlem reddedilir.

Setup edits jail-role overwrites on existing channels. Re-run after creating channels. Only explicitly configured roles are temporarily removed. Restoration refuses changed, dangerous, deleted, managed, or higher roles. The bot rejects conflicting channel overwrites instead of claiming an ineffective jail.

## Destek / Tickets

```text
.ticket setup SUPPORT_ROLE_ID CATEGORY_ID|- LOG_CHANNEL_ID|- on|off
.ticket panel
.ticket open
.ticket claim
.ticket close
.ticket transcript
.ticket reconcile USER_ID
.ticket reset USER_ID
```

Son `on|off` döküm iznidir, varsayılan kapalı. Destek rolü tehlikeli yerel yönetim yetkileri taşımamalı. Kanal yalnız talep sahibi, destek rolü ve bot için açık oluşturulur; Discord yöneticileri Discord kuralları gereği erişebilir. Kapatma kanalı silmez, talep sahibinin yazmasını durdurur. Döküm yalnız açıkça etkinleştirildiğinde, yetkili katılımcıya özel kanalda/ephemeral yanıtta son 100 iletiyi JSON olarak verir. Dosya içerikleri indirilmez. Belirsiz kanal oluşturma sonucunda tekrar kanal açmak yerine topic kimliğiyle uzlaştırma yapılır; reset en az beş dakika ve orphan kontrolü ister.

The final on/off flag opts into transcripts (off by default). Tickets are private explicit-overwrite channels; Discord administrators retain platform-level access. Closing preserves history. Authorized transcripts contain the latest 100 messages and attachment metadata, not attachment contents. Ambiguous creation is reconciled using the durable topic ID; reset requires a five-minute wait and an orphan check.

## Karşılama ve araçlar / Welcome and utilities

```text
.welcome join CHANNEL_ID
.welcome leave CHANNEL_ID
.welcome role ROLE_ID
.welcome template {user}, {server} sunucusuna hoş geldin!
.welcome leavetemplate {user} ayrıldı.
.welcome image https://example.com/welcome.png
.selfrole buttons ROLE_ID ROLE_ID
.selfrole select ROLE_ID ROLE_ID
.custom set kurallar Lütfen kuralları okuyun.
.custom delete kurallar
.autoresponse set merhaba Merhaba!
.suggest Öneri metni
.suggestion approve SUGGESTION_ID
.suggestion reject SUGGESTION_ID
.announce 1h Duyuru metni
.announce cancel JOB_ID
.sticky set Kanal yönergesi
.sticky off
.embed Başlık | Açıklama
.cleanup 90
```

Özel komut ve otomatik yanıtlar yalnız kayıtlı metin gönderir; JavaScript veya şablon kodu çalıştırılmaz. `@` işaretleri etkisizleştirilir, otomatik mention parse kapalıdır. Otomatik yanıt tam tetikleyici eşleşmesiyle ve kullanıcı/kanal beklemesiyle çalışır. Yapışkan mesajlar en sık dakikada bir yenilenir. Duyurular kalıcı, tek seferlik işlerdir; periyodik duyuru kuralı bulunmaz.

Custom commands and auto responses send plain stored text, never executable code. Automatic mentions are disabled. Auto responses match the complete configured trigger and have a per-user/channel cooldown. Sticky messages refresh at most once per minute. Announcements are durable one-shot tasks. `.cleanup 90` cleans terminal metadata older than 90 days and enables a persistent daily cleanup job. Active/uncertain states, outstanding job dependencies, unprocessed game rewards, wallets, grants, cases, and idempotency ledgers are retained. Closed ticket channel records may expire, but this cleanup never deletes Discord channels.

Ekonomi/XP/sosyal ayrıntılar için [SYSTEMS.md](SYSTEMS.md), tüm komutlar için [COMMANDS.md](COMMANDS.md).
