# Mimari, veri ve işletim

`src/core/types.ts`, modüller arasındaki ortak sözleşmedir. Her modül `name` ve `register(runtime)` sunar. `src/modules/index.ts` tek bağlama listesidir. Komut kaydı isim, takma adlar, modül/kategori, açıklama çeviri anahtarı, kullanım, yetki, bekleme, etkinlik durumu ve yürütme işlevini içerir. Tüm komutlar sunucuya özeldir; DM'den sunucu komutu çalıştırılmaz.

Prefix mesajı `.`, merkezi parser ve registry'den geçer. Slash `/executive run` aynı `CommandContext` ve execute yolunu kullanır. Düğme/seçici/modal kimlikleri merkezi etkileşim router'ında modül önekine göre yönlendirilir. Kalıcı bileşenler geçici collector gerektirmez. İlk yanıtı modal-capable handler verir; uzun işlemler önceden defer edilir. Mention parse varsayılan olarak kapalıdır.

## Veri

SQLite, WAL, foreign_keys ve busy_timeout ile açılır. Drizzle gerçek okuma/yazma sorgularını oluşturur. İlk geçiş `migrations` tablosunda sürümlenir ve transaction içinde uygulanır; var olan veri silinmez. `records` tablosu `(guild, namespace, key)` bileşik anahtarı ve scope/tarih indeksiyle ayrılmış, JSON doğrulamalı domain kayıtları tutar. Domain servisleri tipli kayıtları yönetir.

Ekonomi, XP, ilişki, oy ve rezervasyon işlemleri senkron `BEGIN IMMEDIATE` transaction veya nested savepoint ile atomiktir. Asenkron Discord çağrıları transaction içinde bekletilmez. Finansal işlem/ödül defterleri tekrar uygulamayı önler. Paralar güvenli tamsayı ve yapılandırılabilir üst sınır kullanır.

Bu veri katmanı küçük/orta ölçekli tek işlem kurulumunu hedefler. Bazı sıralama, oturum ve iş sorguları sunucunun namespace kayıtlarını tarar. Çok büyük kurulumlarda domain bazlı tablolar, sorgular ve shard iş sahipliği eklenmelidir. Hazır çok süreçli/shard dağıtımı uygulanmamıştır; aynı SQLite dosyasına birden fazla bot süreci bağlamayın.

## Kalıcı işler

Scheduler beş saniyede bir yalnız yerel SQLite işlerini kontrol eder; sürekli Discord API yoklaması yapmaz. İşler sunucu, modül, tür, vade, payload, deneme ve lease içerir. Modül kapalıyken iş korunur. Hata halinde artan beklemeyle tekrar denenir. Yeniden başlatmada etkin lease en fazla beş dakika gecikme yaratabilir. Normal kapanış yeni işleri durdurur, çalışan olay ve görevleri bekler, sonra Discord/veritabanını kapatır.

Discord dış etkileri için dağıtık exactly-once garanti edilemez. Kalıcı durum, idempotent API çağrısı, kontrollü mesaj düzenleme, request/nonce ve tekrar ödül defterleri riskleri sınırlar. Belirsiz moderasyon işlemi otomatik yeniden cezalandırılmaz. Hatırlatma/duyuru teslimleri en az bir kez modelindedir; Discord nonce kısa süreli tekrarları azaltır, sınırsız exactly-once garantisi değildir.

## Yetki ve güvenlik

Yapılandırma hakkı sunucu sahibine ve açık delegasyonlara aittir. Komut grant'leri sunucu namespace'inde tutulur; farklı sunucuya geçmez. Hedef hiyerarşisi, korumalı kişi/roller ve botun kendi rol konumu ayrı ayrı kontrol edilir. Public rol ödülleri native/channel yetkileri yanında Executive komut yetkileri ve personel sırasına karşı doğrulanır.

Prefix beklemeleri kalıcıdır. Merkezi sunucu komut sınırı, kullanıcı/işlem moderasyon sınırı ve kullanıcı/sunucu etkileşim sınırı vardır. Discord REST istemcisinin rate-limit kuyruğu kullanılır; 429 yakalandığında sınırsız manuel retry döngüsü yoktur. Scheduler hataları kontrollü beklemeye alınır. Loglarda token redaction vardır; bot token'ını kullanıcı girdisi veya hata bağlamına eklemeyin.

## English notes

The registry is the single command source. Prefix and slash share execution. Components are routed by durable module IDs and reauthorize each use. SQLite/Drizzle stores typed JSON records under a guild/namespace/key composite primary key. Transactions remain synchronous; external API calls occur outside them.

The scheduler persists due work, retries with backoff, pauses disabled modules, and drains active work before database shutdown. Discord effects cannot have an unconditional distributed exactly-once guarantee. Financial rewards are idempotent locally; moderation ambiguities require reconciliation. Delivery uses durable at-least-once handling and nonce deduplication where supported.

This is a single-process local deployment. Some namespace scans need domain-specific indexing for large-scale workloads. Multi-process/shard ownership is an extension point, not a completed feature. Back up the full data directory with the bot stopped, restrict access to database files, and validate deployment in a test guild before public use.
