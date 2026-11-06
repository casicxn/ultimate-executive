# Ekonomi, seviye ve sosyal sistemler / Economy, leveling and social systems

Bu kılavuz mevcut uygulamanın davranışını açıklar. Her sunucunun verileri ve ayarları ayrıdır. Yapılandırma komutlarını sunucu sahibi veya açıkça atanmış yapılandırma yöneticisi kullanır. Komut öneki `.`; isteğe bağlı slash geçidi aynı komutları `/executive run command:<ad> arguments:<argümanlar>` üzerinden çalıştırır. Kullanılabilir komutlar için `.help` kullanın.

This guide describes the current implementation. Data and settings are isolated per guild. Configuration commands require the guild owner or an explicitly delegated configuration manager. The prefix is `.`; the optional slash bridge invokes the same commands with `/executive run command:<name> arguments:<arguments>`. Use `.help` for the available command list.

## Türkçe

### Sanal ekonomi

Executive Coins yalnızca sunucu içi sanal puandır. Gerçek para alımı, çekim, kripto para veya bahis sistemi bulunmaz. Bakiyeler güvenli tam sayılarla tutulur; transfer, satın alma, satış ve ödül kayıtları SQLite transaction kullanır. Negatif bakiye, kendine ödeme ve sınır aşımı reddedilir. Discord isteğinin kimliği transfer/satın alma/kullanım işlemlerinde tekrar işlemeyi engeller. Günlük ve haftalık ödül beklemeleri yeniden başlatmada korunur.

| Komut | İşlev |
| --- | --- |
| `.balance [@üye]` | Cüzdanı gösterir. `.bal`, `.bakiye` eş adlarıdır. |
| `.daily` | Varsayılan 200 puan; son alımdan 24 saat sonra tekrar. |
| `.weekly` | Varsayılan 1500 puan; son alımdan 7 gün sonra tekrar. |
| `.work` | Varsayılan 75 puan; son alımdan 1 saat sonra tekrar. |
| `.pay @üye 100` | Aynı sunucudaki başka bir insan üyeye ödeme. |
| `.shop` | İlk 25 mağaza eşyasını gösterir. |
| `.buy yildiz` | Bir adet eşya alır. |
| `.sell yildiz` | Bir adedi güncel fiyatının yarısına, aşağı yuvarlayarak satar. Rol eşyaları satılmaz. |
| `.inventory` | İlk 25 pozitif envanter kaydını gösterir. `.envanter` eş adıdır. |
| `.use yildiz` | Sahip olunan eşyanın tanımlı etkisini uygular. |
| `.rich` | İlk 20 cüzdanı gösterir. `.leaderboard` ekonomi sıralamasıdır; XP için `.top` kullanın. |

Mağaza kimliği 1–32 küçük harf, rakam, `_` veya `-` içermelidir. Fiyat 1–1.000.000.000 aralığında tam sayıdır. Nadirlik `common`, `rare`, `epic` veya `legendary` olur; nadirlik yalnızca açıklayıcıdır.

```text
.shop add yildiz 100 collectible rare Topluluk Yıldızı
.shop add destekci 500 badge epic Destekçi
.shop add paket 100 consumable common Jeton Paketi
.shop value paket 40
.shop add mavi 1000 role rare Mavi Profil Rolü
.shop role mavi @Mavi
.shop remove yildiz
```

| Eşya türü | `.use` davranışı |
| --- | --- |
| `collectible` | Adını profil rozetlerine ekler; envanter adedi tüketilmez. |
| `badge` | Adını profil rozetlerine ekler; yinelenen rozet oluşturmaz ve adet tüketilmez. |
| `consumable` | Bir adedi tüketir ve `value` kadar sanal para verir. Varsayılan etki sıfırdır; `value` eşya fiyatını aşamaz. |
| `role` | Önceden onaylanmış rolü verir; Discord başarılı olduktan sonra bir adet tüketir. |

Rol eşyaları otomatik yönetim yetkisi veremez. Botun altındaki, yönetilmeyen, sunucu genelinde ve kanal izinlerinde yalnızca izin verilen topluluk yetkileri taşıyan roller kabul edilir. Bot komut yetkisi veren/protected roller ve personel hiyerarşisini yükseltebilecek roller ortak rol güvenlik denetiminden geçemez. Kontrol rol yapılandırılırken, satın alınırken ve kullanılırken tekrarlanır. Discord'da rol/kanal izinleri değiştiğinde eski bir mağaza eşyasının kullanımı da engellenebilir.

Mağazadan kaldırmak geçmiş envanter kayıtlarını silmez; ancak eşya mağazada bulunmadan kullanılamaz veya satılamaz. Aktif envanterde kullanılan kimlikleri farklı bir eşya türü için yeniden kullanmayın.

```text
.economy
.economy set currency Executive Coins
.economy set daily 200
.economy set weekly 1500
.economy set work 75
.economy set workCooldown 3600000
.economy set maxBalance 1000000000000
```

`workCooldown` milisaniyedir; 60.000–86.400.000 aralığındadır. Günlük/haftalık süreler sabittir. Varsayılan `maxBalance` 1.000.000.000.000; izin verilen ayar aralığı 1.000–1.000.000.000.000.000'dır. Mevcut bakiyelerden düşük bir sınır belirlemek bu bakiyeleri silmez; ilgili işlemler yeni sınıra uyana kadar reddedilebilir. Günlük/çalışma ödülleri 0–1.000.000, haftalık ödül 0–10.000.000 arasında olabilir.

### Seviye ve XP

`.level [@üye]` XP ve ilerlemeyi, `.rank [@üye]` PNG kartını, `.top` ilk 20 XP kaydını gösterir. Seviye formülü `floor(sqrt(toplamXP / 100))`; 1. seviye 100, 2. seviye 400 toplam XP gerektirir. Toplam XP üst sınırı 1.000.000.000.000'dır.

Varsayılan olarak uygun mesaj 15 XP kazandırır; aynı üye 60 saniyede bir kazanabilir. Botlar, webhook'lar, `.` ile başlayan komutlar, 3 karakterden kısa kırpılmış metinler ve hariç tutulan kanal/roller sayılmaz. Büyük/küçük harf ve boşlukları normalize edilen içeriğin özeti saklanır. Son 24 saatteki en fazla 20 ödüllendirilmiş içerik özeti arasında aynı içerik tekrar ödüllendirilmez. Ham mesaj metni bu koruma için saklanmaz. Mesaj kimliği ve kalıcı ödül kaydı tekrar işlenen olaydan ikinci XP'yi engeller.

Ses XP'si varsayılan olarak 60 saniyede 10 XP'dir. Aynı kanalda en az iki bot olmayan, uygun ve sessize/sağıra alınmamış insan bulunmalıdır. Üyenin kendini veya sunucu tarafından sessize/sağıra alınması, AFK kanalı, hariç tutulan kanal veya rol uygunluğu kaldırır. Bot konuşma sesini analiz etmez; bunlar Discord ses durumu üzerinden ölçülen katılım koşullarıdır. Yalnız geçen uygun aralık ödüllendirilir; kapalı kalınan süre için geriye dönük XP verilmez. Yeniden başlatmadan sonra en az bir yeni ses aralığının geçmesi gerekir. Daha önce kalıcı ses işi olmayan mevcut bir kanal, ses durumu değişikliğiyle izlemeye alınır.

```text
.xp
.xp set messageXp 15
.xp set messageCooldown 60000
.xp set voiceXp 10
.xp set voiceInterval 60000
.xp set multiplier 1.5
.xp set accent #5865f2
.xp set background #111827
.xp set notifyChannel 123456789012345678
.xp exclude-channel #bot-komutlari
.xp exclude-role @XP-Haric
.xp reward 5 @Seviye5
```

Hariç tutma komutları aynı kimlik tekrar verildiğinde hariç tutmayı kaldırır. `notifyChannel` için ham kanal kimliği kullanın. `messageCooldown` 15.000–3.600.000 ms, `voiceInterval` 60.000–3.600.000 ms; mesaj/ses XP miktarları 0–1.000, çarpan 0–10 arasındadır. Sonuç aşağı yuvarlanır. Rol ödülü yalnız güvenli, botun altındaki rol olabilir; ortak bot yetkisi/personel hiyerarşisi denetimi de uygulanır. Rol/bildirim işleri yeniden başlatmada korunur ve geçici hatalarda tekrar denenir. Oyunla kazanılan seviyenin rol ödülü bir sonraki uygun mesaj/ses etkinliğinde uzlaştırılır.

Kart gerçek 900×280 PNG'dir; avatar, görünen ad, seviye, sıra ve XP ilerlemesini içerir. `accent` ve `background` altı haneli hex renktir; özel arka plan fotoğrafı yükleme arayüzü yoktur. Discord CDN avatarları en fazla 200 girdilik, bir saatlik bellek önbelleğinde tutulur. Avatar alınamazsa baş harfli yedek görsel çizilir.

### Profil, itibar ve ilişkiler

| Komut | İşlev |
| --- | --- |
| `.profil [@üye]` / `.profile` | Bio, seviye/XP, bakiye, itibar, rozetler, isteğe bağlı doğum günü ve sanal partner. |
| `.bio Açıklamam` | En fazla 500 karakterlik herkese açık açıklama. `.bio clear` siler. |
| `.rep @üye` | Başka insan üyeye bir itibar verir. Kendine itibar verilemez. Varsayılan bekleme veren kişi başına 24 saattir; başka hedef seçmek bunu atlatmaz. |
| `.ship @üye [@diğer]` | Gün/sunucu/üye çiftine bağlı, yalnızca eğlence amaçlı uyum yüzdesi. |
| `.evlen @üye` | İki dakika geçerli kabul/red düğmeleriyle sanal teklif. Yalnız davetli yanıtlayabilir. |
| `.partner` | Bu sunucudaki sanal partner. |
| `.bosan` | Bir dakika geçerli kişisel onay düğmesiyle mevcut sanal evliliği sonlandırır. |
| `.afk [sebep]` | Uzakta durumunu kaydeder; sonraki mesajla temizlenir. |

Bir üyenin sunucu başına bir aktif sanal evliliği olabilir. Teklifler zorla kabul edilemez; aynı üyeleri içeren eşzamanlı bekleyen teklifler reddedilir. Kabul, iki karşılıklı ilişki kaydını tek transaction'da yazar. Yeniden evlenildikten sonra eski boşanma onayı yeni ilişkiyi silemez. İtibar beklemeleri ve ilişkiler yeniden başlatmada korunur. AFK bildirimleri kanal/hedef başına dakikada en fazla bir kez, tek mesajda en fazla üç kişiyle sınırlandırılır.

```text
.config social repCooldown 86400000
.config social marriageEnabled off
.config social marriageEnabled on
.config social birthdayChannel #dogum-gunleri
```

`repCooldown` milisaniyedir; 3.600.000–604.800.000 aralığındadır. `marriageEnabled off`, yeni teklif ve bekleyen teklif kabulünü kapatır; kayıtlı evliliği silmez, boşanmayı engellemez. `birthdayChannel` aynı sunucuda metin destekleyen bir kanal olmalıdır. Dil `.config language tr` / `.config language en` ile değişir.

### Hatırlatmalar ve doğum günleri

```text
.hatirlat 2h Toplantı notlarını gözden geçir
.hatirlat list
.hatirlat cancel <kimlik>
.dogumgunu 29-02
.dogumgunu clear
```

Hatırlatma süreleri `s`, `m`, `h`, `d`, `w` ile, en fazla 365 gün olarak verilir. Metin en fazla 1.000 karakterdir. Üye/sunucu başına en fazla 20 bekleyen hatırlatma vardır. Hatırlatmalar kalıcıdır ve özel mesajla gönderilir; özel mesajlar kapalıysa kayıt `failed` olur. Toplu mention yapılmaz. Geçici hatalar tekrar denenir. Teslimat **en az bir kez** modelindedir: Discord'un `enforceNonce` denetimi yakın zamanlı tekrarları azaltır, ancak gönderimin hemen ardından süreç çökerse ve uzun süre sonra açılırsa mutlak tek teslim garantisi verilemez.

Doğum günü isteğe bağlı gün/ay bilgisidir; doğum yılı kaydedilmez. Duyuru kanalı ayarlandıysa, mevcut üye için **09:00 UTC** zamanında duyuru yapılır; yerel saat dilimi seçimi bulunmaz. 29 Şubat geçerli bir sonraki artık yıla planlanır. Bot kapalıyken geçen planlı işler yeniden açıldığında işlenebilir. `.dogumgunu clear` profil tarihini kaldırır; eski görev tarihin artık eşleşmediğini görüp duyuru yapmaz.

`.config module economy off`, `.config module leveling off` veya `.config module social off`, ilgili komutları, olay kancalarını ve zamanlanmış işleri duraklatır; verileri silmez. Tekrar açınca gecikmiş uygun işler işlenir. Bu davranışı doğum günü/hatırlatma gecikmelerini değerlendirirken dikkate alın.

## English

### Virtual economy

Executive Coins are guild-local virtual points with no real monetary value. There are no real-money purchases, withdrawals, cryptocurrency, or wagering features. Wallets use safe integer amounts. Transfers, purchases, sales, and reward receipts run inside SQLite transactions; negative balances, self-payment and overflow are rejected. Request IDs prevent transfer/purchase/use replay. Claim cooldowns survive restarts.

Member commands are `.balance [@member]` (`.bal`, `.bakiye`), `.daily`, `.weekly`, `.work`, `.pay @member amount`, `.shop`, `.buy item-id`, `.sell item-id`, `.inventory` (`.envanter`), `.use item-id`, and `.rich` (`.leaderboard`). `.leaderboard` is the economy leaderboard; use `.top` for XP. The shop and inventory display their first 25 entries; the wealth leaderboard displays 20 wallets.

Defaults: daily 200 coins every 24 hours, weekly 1,500 every 7 days, work 75 every hour. Daily/weekly periods are fixed. Configure amounts and the work period with:

```text
.economy
.economy set currency Executive Coins
.economy set daily 200
.economy set weekly 1500
.economy set work 75
.economy set workCooldown 3600000
.economy set maxBalance 1000000000000
```

`workCooldown` uses milliseconds and accepts 60,000–86,400,000. Daily/work rewards accept 0–1,000,000; weekly accepts 0–10,000,000. The default balance cap is 1,000,000,000,000, configurable from 1,000 to 1,000,000,000,000,000. Lowering the cap below existing balances does not delete funds, but related operations can be rejected until they satisfy the new limit.

Configuration managers create items with `.shop add id price type rarity name`. IDs use 1–32 lowercase letters, digits, `_`, or `-`. Prices are integers from 1 to 1,000,000,000. Rarity is descriptive: `common`, `rare`, `epic`, `legendary`.

```text
.shop add star 100 collectible rare Community Star
.shop add supporter 500 badge epic Supporter
.shop add pack 100 consumable common Coin Pack
.shop value pack 40
.shop add blue 1000 role rare Blue Profile Role
.shop role blue @Blue
.shop remove star
```

| Type | Effect of `.use` |
| --- | --- |
| `collectible` | Adds the item name to profile badges without consuming quantity. |
| `badge` | Adds a unique profile badge without consuming quantity. |
| `consumable` | Consumes one and credits its configured `value`. The default value is zero; it cannot exceed the item price. |
| `role` | Grants its approved role, consuming one only after Discord confirms the addition. |

Selling consumes one item and returns half its current price, rounded down. Role items cannot be sold. Removing a shop definition preserves existing inventory records, but the item cannot be used or sold without that definition. Avoid reusing an active inventory ID for an incompatible item type.

Reward roles must be unmanaged and below the bot, with only approved community permissions both globally and in channel overwrites. The shared public-role guard also rejects custom command authorization roles, protected roles and roles that would elevate staff hierarchy. Checks run during role setup, purchase and use; later Discord permission changes can make an old item unusable.

### Leveling

`.level [@member]` displays XP/progress, `.rank [@member]` renders a PNG rank card, and `.top` displays 20 XP leaders. Level is `floor(sqrt(totalXP / 100))`: level 1 starts at 100 XP and level 2 at 400. The total XP cap is 1,000,000,000,000.

Default message XP is 15 per eligible message, at most once per member per 60 seconds. Bots, webhooks, commands starting with `.`, trimmed text shorter than three characters, and excluded channels/roles do not qualify. Case/whitespace-normalized content is hashed; a match among the last 20 rewarded hashes within 24 hours earns no additional XP. Raw content is not stored for this check. Persistent message reward receipts suppress repeated event delivery.

Voice defaults to 10 XP per 60 eligible seconds. At least two eligible humans must be in the channel. Self/server mute or deaf, the guild AFK channel, and excluded channels/roles disqualify activity. The bot checks Discord voice states; it does not analyze speech. There is no accumulated offline XP. After restart, at least one new voice interval must elapse. A channel without previously persisted voice tracking starts tracking on a voice-state change.

```text
.xp
.xp set messageXp 15
.xp set messageCooldown 60000
.xp set voiceXp 10
.xp set voiceInterval 60000
.xp set multiplier 1.5
.xp set accent #5865f2
.xp set background #111827
.xp set notifyChannel 123456789012345678
.xp exclude-channel #bot-commands
.xp exclude-role @No-XP
.xp reward 5 @Level5
```

Exclusion commands toggle the given ID. `notifyChannel` accepts a raw channel ID. Message cooldown range: 15,000–3,600,000 ms; voice interval: 60,000–3,600,000 ms. Each XP amount accepts 0–1,000; multiplier accepts 0–10. Awards round down. Reward roles must pass both the safe-permission and shared public-role/staff-hierarchy checks. Role and notification work is durable and retries transient failures. A role earned by a game level is reconciled on the next eligible message or voice award.

Rank cards are actual 900×280 PNG files with avatar, display name, level, rank and progress. Accent/background accept six-digit hex colors. There is no custom background-photo upload interface. Discord CDN avatars have a bounded in-memory cache of 200 entries for one hour. Failed avatar retrieval falls back to an initial-based avatar.

### Social features

`.profile [@member]` (`.profil`) shows bio, XP/level, balance, reputation, equipped badges, optional birthday and virtual partner. `.bio text` saves up to 500 public characters; `.bio clear` removes it. `.rep @member` gives one reputation point to another human, with one persistent giver-wide cooldown (24 hours by default). Switching recipients does not bypass that cooldown. `.ship @member [@other]` produces a daily guild/pair-specific compatibility score for fun.

`.evlen @member` creates a two-minute proposal. Only the invited member can accept/reject its buttons. A member can have one active guild-specific virtual marriage; overlapping pending proposals are rejected. Acceptance writes both relationship records atomically. `.partner` displays the partner. `.bosan` opens a one-minute confirmation for the invoking member; an old confirmation cannot end a later marriage. Relationships and reputation cooldowns survive restart.

`.afk [reason]` sets an away status, cleared on the next message. AFK mention notices are limited to once per channel/target per minute and three targets in one message.

```text
.config social repCooldown 86400000
.config social marriageEnabled off
.config social marriageEnabled on
.config social birthdayChannel #birthdays
.config language en
```

Reputation cooldown is milliseconds in the range 3,600,000–604,800,000. Disabling marriage prevents new proposals and pending-proposal acceptance; it preserves existing relationships and still permits divorce. The birthday channel must be text-capable in the same guild.

### Reminders and birthdays

`.hatirlat 2h Review meeting notes` creates a persistent DM reminder; `.remind` is an alias. Use `.hatirlat list` and `.hatirlat cancel id` for management. Duration units are `s`, `m`, `h`, `d`, `w`, up to 365 days; text is limited to 1,000 characters and each guild member can have 20 pending reminders. DMs must be open. Closed-DM delivery is recorded as failed; transient errors are retried. Mass mentions are suppressed.

Reminder delivery is **at least once**. Discord's enforced nonce suppresses recent duplicates, but a process crash immediately after sending followed by a long outage can still result in a duplicate. No absolute external-API exactly-once delivery is claimed.

`.dogumgunu DD-MM` stores an optional day/month without a birth year; `.dogumgunu clear` removes it. When a birthday channel is configured, announcements for current members are scheduled at **09:00 UTC**. There is no selectable local timezone. February 29 schedules the next valid leap year. Overdue jobs can be processed after the bot restarts; removing/changing the date prevents mismatched old jobs from announcing.

`.config module economy off`, `.config module leveling off`, and `.config module social off` pause the corresponding commands, event hooks and scheduled work while preserving data. Re-enabling a module permits eligible overdue work to resume.
