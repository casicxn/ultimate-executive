import { registerTranslations } from "../../core/localization.js";
registerTranslations({
  "ticket.description": {
    tr: "Özel destek talepleri ve kalıcı destek paneli.",
    en: "Private support tickets and persistent ticket panels.",
  },
  "ticket.usage": {
    tr: ".ticket setup @destekRolü [kategoriId|-] [kayıtKanalıId|-] [on|off] • panel • open • close • claim • transcript • reconcile @üye • reset @üye",
    en: ".ticket setup @supportRole [categoryId|-] [logChannelId|-] [on|off] • panel • open • close • claim • transcript • reconcile @user • reset @user",
  },
  "ticket.setupRequired": {
    tr: "Önce sunucu yapılandırma yöneticisi .ticket setup komutunu kullanmalı.",
    en: "A guild configuration manager must first run .ticket setup.",
  },
  "ticket.panel": {
    tr: "Destek ekibiyle özel bir görüşme başlatmak için düğmeyi kullanın.",
    en: "Use the button to start a private conversation with the support team.",
  },
  "ticket.open": { tr: "Destek talebi aç", en: "Open a ticket" },
  "ticket.close": { tr: "Talebi kapat", en: "Close ticket" },
  "ticket.claim": { tr: "Üstlen", en: "Claim" },
  "ticket.created": {
    tr: "Özel destek kanalınız hazır: <#{channel}>",
    en: "Your private support channel is ready: <#{channel}>",
  },
  "ticket.welcome": {
    tr: "Talep sahibi: {user}. Konuyu burada açıklayabilirsiniz. Kapanan talepler silinmez. Döküm özelliği yönetici tarafından açıkça etkinleştirilirse en son 100 ileti dışa aktarılabilir.",
    en: "Ticket owner: {user}. Describe your issue here. Closed tickets are retained. If explicitly enabled by an administrator, the latest 100 messages can be exported.",
  },
  "ticket.existing": {
    tr: "Zaten açık veya oluşturulması doğrulanmayı bekleyen bir talebiniz var: {channel}",
    en: "You already have an open ticket or one awaiting creation verification: {channel}",
  },
  "ticket.pending": {
    tr: "Kanalın oluşturulma sonucu belirsiz. Yeni bir kanal açılmadı. Yönetici .ticket reconcile @üye ile kontrol edebilir.",
    en: "Channel creation could not be verified. No additional channel was created. An administrator can run .ticket reconcile @user.",
  },
  "ticket.closed": {
    tr: "Destek talebi kapatıldı. Kanal ve kayıtlar korundu.",
    en: "The ticket is closed. The channel and records have been retained.",
  },
  "ticket.notTicket": {
    tr: "Bu kanal bir Executive destek talebi değil.",
    en: "This channel is not an Executive ticket.",
  },
  "ticket.notOpen": {
    tr: "Bu destek talebi açık değil.",
    en: "This ticket is not open.",
  },
  "ticket.claimed": {
    tr: "Destek talebini üstlenen yetkili: {user}",
    en: "Ticket claimed by staff member: {user}",
  },
  "ticket.alreadyClaimed": {
    tr: "Bu talep başka bir yetkili tarafından üstlenildi.",
    en: "This ticket is already claimed by another staff member.",
  },
  "ticket.transcriptOff": {
    tr: "Döküm alma sunucu yapılandırmasında etkinleştirilmemiş.",
    en: "Transcripts are not enabled in the guild configuration.",
  },
  "ticket.transcript": {
    tr: "Yetkili isteğiyle son {count} iletinin dökümü. Yalnız bu özel kanalda paylaşılır.",
    en: "Transcript of the latest {count} messages, requested by an authorized participant. Shared only in this private channel.",
  },
  "ticket.unsafeChannel": {
    tr: "Kanalın gizlilik izinleri değiştirilmiş. İşlemden önce yönetici izinleri düzeltmeli.",
    en: "The channel privacy permissions have changed. An administrator must repair them before this action.",
  },
  "ticket.roleUnsafe": {
    tr: "Destek rolü normal bir rol olmalı; yönetim yetkileri içermemeli ve bot rolünün altında olmalı.",
    en: "The support role must be a regular role without administrative permissions and below the bot role.",
  },
  "ticket.reconciled": {
    tr: "Talep kaydı mevcut kanal ile eşleştirildi: <#{channel}>",
    en: "The ticket record was reconciled with the existing channel: <#{channel}>",
  },
  "ticket.reset": {
    tr: "Oluşturulamayan talep kaydı arşivlendi. Kullanıcı yeniden talep açabilir.",
    en: "The uncreated ticket record was archived. The user can open a new ticket.",
  },
  "ticket.resetWait": {
    tr: "Sıfırlamadan önce en az 5 dakika bekleyin ve sunucudaki kanalları kontrol edin.",
    en: "Wait at least five minutes and verify the guild channels before resetting.",
  },
  "ticket.log": {
    tr: "Destek işlemi: {action} • kayıt {id} • kullanıcı {user} • kanal {channel} • yetkili {actor}",
    en: "Ticket action: {action} • record {id} • user {user} • channel {channel} • actor {actor}",
  },
  "ticket.status.creating": { tr: "oluşturuluyor", en: "creating" },
  "ticket.status.open": { tr: "açık", en: "open" },
  "ticket.status.closing": { tr: "kapanıyor", en: "closing" },
  "ticket.status.closed": { tr: "kapalı", en: "closed" },
  "ticket.status.uncertain": {
    tr: "doğrulama bekliyor",
    en: "awaiting verification",
  },
  "ticket.status.failed": { tr: "oluşturulamadı", en: "creation failed" },
});
