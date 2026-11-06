# Komutlar / Commands

**Developed by Casi**

Komutları `/executive run` ile de çalıştırabilirsiniz. Dil seçimi için `/executive language` menüsünü kullanın.

| Komut | Takma adlar | Modül | Yetki | Türkçe | English |
|---|---|---|---|---|---|
| .ban @user [1d] [reason] |  | moderation | ban | Üyeyi yasaklar; isteğe bağlı süre alır. | Ban a user, optionally for a duration. |
| .unban userId [reason] |  | moderation | unban | Kullanıcının yasağını kaldırır. | Remove a user ban. |
| .kick @user [reason] |  | moderation | kick | Üyeyi sunucudan çıkarır. | Kick a member. |
| .mute @user 1h [reason] | timeout | moderation | mute | Üyeye Discord zaman aşımı uygular. | Apply a native Discord timeout. |
| .unmute @user [reason] |  | moderation | unmute | Üyenin zaman aşımını kaldırır. | Remove a native Discord timeout. |
| .sil 1-100 [reason] | purge, clear | moderation | sil | Son 14 gündeki mesajları güvenle siler. | Safely delete recent messages from the last 14 days. |
| .warn @user reason |  | moderation | warn | Üyeye kayıtlı uyarı verir. | Issue a recorded warning. |
| .warnings @user | uyarilar | moderation | warnings | Etkin uyarıları gösterir. | Show active warnings. |
| .clearwarn caseId [reason] |  | moderation | clearwarn | Uyarıyı geri alır, işlem geçmişini korur. | Revoke a warning while retaining the case history. |
| .jail @user [1h] [reason] |  | moderation | jail | Yapılandırılmış karantina rolünü uygular. | Apply the configured jail role. |
| .unjail @user [reason] |  | moderation | unjail | Karantinayı kaldırır ve güvenli rolleri geri yükler. | Remove jail and safely restore roles. |
| .lock [reason] |  | moderation | lock | Kanalı yazmaya kapatır. | Lock a channel for messages. |
| .unlock [reason] |  | moderation | unlock | Kanalın önceki yazma iznini geri yükler. | Restore a channel’s previous message permission. |
| .slowmode 0-21600 [reason] |  | moderation | slowmode | Kanal yavaş modunu ayarlar. | Set a channel slowmode. |
| .nick @user new nickname \| - |  | moderation | nick | Üyenin takma adını değiştirir. | Change a member nickname. |
| .renk @role #RRGGBB | color | moderation | renk | Güvenli bir rolün rengini değiştirir. | Change the color of a safe role. |
| .cezalar [@user] | sicil, cases | moderation | cezalar | Ceza ve işlem geçmişini gösterir. | Show punishment and action history. |
| .modstats [@staff] |  | moderation | modstats | Yetkili işlem istatistiklerini gösterir. | Show staff action statistics. |
| .jailsetup @role #channel [@removeRoles...] |  | moderation | config | Karantina rolünü, kanalını ve kaldırılacak rolleri ayarlar. | Configure the jail role, channel and roles to remove. |
| .staff | yetki | staff | config | Komut yetkilerini, grupları ve korumaları yönetir. | Manage command grants, groups and protections. |
| .tkm [@user] | rps | entertainment | — | Botla veya davet ettiğin oyuncuyla taş kağıt makas oyna. | Play rock paper scissors against the bot or an invited player. |
| .xox @user | tictactoe | entertainment | — | Bir oyuncuyu XOX oyununa davet et. | Invite a player to tic tac toe. |
| .connect4 @user |  | entertainment | — | Bir oyuncuyu dört birleştir oyununa davet et. | Invite a player to Connect Four. |
| .quiz [general\|technology\|gaming\|science\|geography\|history] |  | entertainment | — | Yerel soru bankasından bilgi yarışması başlat. | Start a quiz using the local question bank. |
| .kelime | word | entertainment | — | Karışık harflerden kelimeyi bul. | Unscramble a word. |
| .adamasmaca | hangman | entertainment | — | Harf veya kelime tahmini yaparak kazan. | Win by guessing letters or the whole word. |
| .duello @user | duel | entertainment | — | Bir oyuncuyla sıra tabanlı sanal düello yap. | Play a turn-based virtual duel with a player. |
| .sayi | tahmin, number | entertainment | — | Yedi tahminde gizli sayıyı bul. | Find the hidden number within seven guesses. |
| .emoji |  | entertainment | — | Emoji bulmacasını çöz. | Solve an emoji puzzle. |
| .yazitura | coinflip | entertainment | — | Sanal yazı tura at. | Flip a virtual coin. |
| .zar [count:1-5] [sides:2-1000] | dice | entertainment | — | Bir veya birkaç sanal zar at. | Roll one or several virtual dice. |
| .8ball question |  | entertainment | — | Eğlencelik bir soruya rastgele cevap al. | Receive a random answer to a question for fun. |
| .balance [@user] | bal, bakiye | economy | — | Cüzdan bakiyesini gösterir. | Show a wallet balance. |
| .daily |  | economy | — | Günlük sanal ödülünü al. | Claim your daily virtual reward. |
| .weekly |  | economy | — | Haftalık sanal ödülünü al. | Claim your weekly virtual reward. |
| .work |  | economy | — | Çalışarak sanal para kazan. | Earn virtual coins by working. |
| .pay @user amount |  | economy | — | Başka üyeye sanal para gönder. | Send virtual coins to another member. |
| .shop [add id price type rarity name \| role id @role \| value id coins \| remove id] |  | economy | — | Mağazayı görüntüle veya yapılandır. | View or configure the shop. |
| .buy item-id |  | economy | — | Mağazadan eşya satın al. | Buy an item from the shop. |
| .sell item-id |  | economy | — | Eşyayı yarı fiyatına sat. | Sell an item for half its price. |
| .inventory | envanter | economy | — | Envanterini görüntüle. | View your inventory. |
| .use item-id |  | economy | — | Envanterindeki eşyayı kullan. | Use an inventory item. |
| .economy [set currency\|daily\|weekly\|work\|workCooldown\|maxBalance value] |  | economy | — | Sanal ekonomi ayarları. | Configure the virtual economy. |
| .rich | leaderboard | economy | — | Sunucu zenginlik sıralaması. | Show the guild wealth leaderboard. |
| .level [@user] |  | leveling | — | Seviye ve XP bilgilerini göster. | Show level and XP information. |
| .rank [@user] |  | leveling | — | Kişisel sıralama kartını görüntüle. | Show your personal rank card. |
| .top |  | leveling | — | Sunucu XP sıralaması. | Show the guild XP leaderboard. |
| .xp [set field value \| exclude-channel #channel \| exclude-role @role \| reward level @role] |  | leveling | — | XP sistemi ve rol ödüllerini yapılandır. | Configure XP and level reward roles. |
| .profile [@user] | profil | social | — | Topluluk profilini görüntüle. | View a community profile. |
| .bio description \| clear |  | social | — | Herkese açık profil açıklamasını değiştir. | Change your public profile description. |
| .rep @user |  | social | — | Başka bir üyeye itibar ver. | Give reputation to another member. |
| .ship @user [@other] |  | social | — | Eğlence amaçlı uyum puanı. | A compatibility score for fun. |
| .evlen @user |  | social | — | Onay gerektiren sanal evlilik teklifi yap. | Send a consent-based virtual marriage proposal. |
| .partner |  | social | — | Sanal partnerini görüntüle. | View your virtual partner. |
| .bosan |  | social | — | Sanal evliliği sonlandır. | End a virtual marriage. |
| .afk [reason] |  | social | — | Uzakta durumunu ayarla. | Set your away status. |
| .hatirlat duration text \| list \| cancel id | remind | social | — | Özel mesajla kalıcı hatırlatma oluştur. | Create a persistent reminder delivered by DM. |
| .dogumgunu DD-MM \| clear |  | social | — | İsteğe bağlı doğum günü belirle. | Set an optional birthday. |
| .giveaway 1h 2 prize [role=ID] [minlevel=5] [accountdays=7] | cekilis, çekiliş | giveaways | giveaways.manage | Kalıcı ve koşullu katılımla çekiliş oluştur. | Create a persistent giveaway with eligibility requirements. |
| .reroll giveaway-id |  | giveaways | giveaways.manage | Çekilişte önceki kazananlar dışında yeni kazanan seç. | Choose new winners excluding previous giveaway winners. |
| .giveawayhistory | cekilisgecmisi | giveaways | — | Bu sunucunun çekiliş geçmişini görüntüle. | View this server’s giveaway history. |
| .anket 10m Question \| Option A \| Option B | poll | giveaways | polls.manage | Süreli, kalıcı ve düğmeli anket oluştur. | Create a timed, persistent button poll. |
| .etkinlik 1d Title \| Description OR .etkinlik cancel event-id | event | giveaways | events.manage | Katılım takibi ve kalıcı hatırlatmayla etkinlik planla. | Schedule an event with RSVPs and a persistent reminder. |
| .ticket |  | tickets | — | Özel destek talepleri ve kalıcı destek paneli. | Private support tickets and persistent ticket panels. |
| .help [sayfa/page] | yardim, yardım | utilities | — | Komut listesi ve kullanımları | Command list and usage |
| .ping | uptime | utilities | — | Topluluk araçları ve bilgiler | Community utilities and information |
| .serverinfo [id] |  | utilities | — | Topluluk araçları ve bilgiler | Community utilities and information |
| .userinfo [id] |  | utilities | — | Topluluk araçları ve bilgiler | Community utilities and information |
| .avatar [id] |  | utilities | — | Topluluk araçları ve bilgiler | Community utilities and information |
| .roleinfo [id] |  | utilities | — | Topluluk araçları ve bilgiler | Community utilities and information |
| .channelinfo [id] |  | utilities | — | Topluluk araçları ve bilgiler | Community utilities and information |
| .embed <başlık \| açıklama> |  | utilities | config | Topluluk araçları ve bilgiler | Community utilities and information |
| .selfrole [buttons\|select] <roleId...> |  | utilities | config | Rol seçimi • açmak/kaldırmak için tıklayın | Self roles • click to add/remove |
| .suggest <metin> | oneri, öneri | utilities | — | Öneri | Suggestion |
| .suggestion approve\|reject <id> |  | utilities | config | Öneri | Suggestion |
| .custom set\|delete <name> [text] |  | utilities | config | Özel komut, otomatik yanıt ve duyuru ayarları | Custom commands, auto responses, and announcements |
| .autoresponse set\|delete <name> [text] |  | utilities | config | Özel komut, otomatik yanıt ve duyuru ayarları | Custom commands, auto responses, and announcements |
| .announce <1h> <metin> \| cancel <id> |  | utilities | config | Özel komut, otomatik yanıt ve duyuru ayarları | Custom commands, auto responses, and announcements |
| .sticky set <metin> \| off |  | utilities | config | Özel komut, otomatik yanıt ve duyuru ayarları | Custom commands, auto responses, and announcements |
| .cleanup <30..3650 gün/days> |  | utilities | config | Temizleme: {days} günden eski tamamlanmış kayıtlar. Silinen: {count} | Cleanup: completed records older than {days} days. Deleted: {count} |
| .welcome join\|leave\|role\|template\|leavetemplate\|image <id\|metin\|https-url> |  | welcome | config | Karşılama ve ayrılma mesajlarını yapılandır | Configure welcome and goodbye messages |
| .stats | istatistik | statistics | — | Sunucunun mesaj ve ses etkinliği | Guild message and voice activity |
| .panel |  | panel | config | Ultimate Executive • Yönetim | Ultimate Executive • Management |
| .language [tr\|en] | dil, lang | configuration | config | Sunucu dilini görüntüle veya değiştir | View or change the server language |
| .config | ayar | configuration | config | Sunucu modülleri, komutlar ve sosyal ayarlar | Guild modules, commands, and social settings |
| .system |  | configuration | — | Bot sahibi için uygulama durumu | Application health for the bot owner |
