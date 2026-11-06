# Ultimate Guard ile birlikte çalışma

Ultimate Guard sunucuyu korur; Ultimate Executive yetkili insanın istediği işlemi yapar. Guard kurulu olmadan Executive bağımsız çalışır. Bu proje Guard'ın belgelenmemiş API'lerini çağırmaz veya iki bot arasında token/özel kimlik bilgisi paylaşmaz.

Discord denetim kaydında işlemi yapan hesap Executive olarak görünebilir. Desteklenen moderasyon API gerekçelerine şu biçim eklenir:

```text
Executive case=42 moderator=123456789012345678 | Kullanıcının gerekçesi
```

SQLite vaka kaydı gerçek başlatanı, sunucuyu, hedefi, işlem türünü, gerekçeyi, süreyi, sonucu ve geri alma bilgilerini saklar. Toplu silme gibi API'nin özel audit reason kabul etmediği işlemlerde insan ve vaka verisi yerel kayıtta kalır.

Guard'ın kendi belgelenmiş güven ayarlarında yalnız ihtiyaç duyulan **Executive bot kimliği + işlem türü + ilgili sunucu** için dar kapsamlı güven tanımlayın. Örneğin ban, kick, timeout veya rol işlemleri farklı ele alınabilir. Guard'ın sürümüne göre gerçek yapılandırma biçimini kendi belgelerinden doğrulayın; burada uyumluluk adına uydurulmuş bir anahtar veya otomatik whitelist yoktur.

- Tüm botlara toplu güven vermeyin.
- Executive'e kanal silme veya ilgisiz koruma olayları için sınırsız muafiyet vermeyin.
- BOT_OWNER_ID, bot uygulamasının sahibidir; vaka içindeki moderator ID gerçek insanı gösterir.
- Test sunucusunda dar kapsamlı bir işlem yapıp hem Guard hem Executive kayıtlarını karşılaştırın.
- Guard üretici/API sürümüne karşı canlı entegrasyon testi henüz yapılmamıştır.

# Working with Ultimate Guard

Guard protects the guild; Executive performs commands initiated by authorized people. Executive runs independently without Guard. No undocumented Guard API or shared credentials are required.

Supported audit reasons contain the case ID and actual human moderator ID using the format above. Local cases retain attribution even when a particular Discord API does not accept an audit reason.

Configure trust only through Guard's documented controls, scoped to Executive's bot identity, the guild, and the required action types. Never whitelist every bot or grant an unrelated blanket bypass. Validate both bots' logs in a controlled test guild. No live Guard integration has been verified in this delivery.
