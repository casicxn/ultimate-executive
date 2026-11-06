import { registerTranslations } from "../../core/localization.js";
registerTranslations({
  "mod.ban": {
    tr: "Üyeyi yasaklar; isteğe bağlı süre alır.",
    en: "Ban a user, optionally for a duration.",
  },
  "mod.unban": {
    tr: "Kullanıcının yasağını kaldırır.",
    en: "Remove a user ban.",
  },
  "mod.kick": { tr: "Üyeyi sunucudan çıkarır.", en: "Kick a member." },
  "mod.mute": {
    tr: "Üyeye Discord zaman aşımı uygular.",
    en: "Apply a native Discord timeout.",
  },
  "mod.unmute": {
    tr: "Üyenin zaman aşımını kaldırır.",
    en: "Remove a native Discord timeout.",
  },
  "mod.sil": {
    tr: "Son 14 gündeki mesajları güvenle siler.",
    en: "Safely delete recent messages from the last 14 days.",
  },
  "mod.warn": {
    tr: "Üyeye kayıtlı uyarı verir.",
    en: "Issue a recorded warning.",
  },
  "mod.warnings": {
    tr: "Etkin uyarıları gösterir.",
    en: "Show active warnings.",
  },
  "mod.clearwarn": {
    tr: "Uyarıyı geri alır, işlem geçmişini korur.",
    en: "Revoke a warning while retaining the case history.",
  },
  "mod.jail": {
    tr: "Yapılandırılmış karantina rolünü uygular.",
    en: "Apply the configured jail role.",
  },
  "mod.unjail": {
    tr: "Karantinayı kaldırır ve güvenli rolleri geri yükler.",
    en: "Remove jail and safely restore roles.",
  },
  "mod.lock": {
    tr: "Kanalı yazmaya kapatır.",
    en: "Lock a channel for messages.",
  },
  "mod.unlock": {
    tr: "Kanalın önceki yazma iznini geri yükler.",
    en: "Restore a channel’s previous message permission.",
  },
  "mod.slowmode": {
    tr: "Kanal yavaş modunu ayarlar.",
    en: "Set a channel slowmode.",
  },
  "mod.nick": {
    tr: "Üyenin takma adını değiştirir.",
    en: "Change a member nickname.",
  },
  "mod.renk": {
    tr: "Güvenli bir rolün rengini değiştirir.",
    en: "Change the color of a safe role.",
  },
  "mod.history": {
    tr: "Ceza ve işlem geçmişini gösterir.",
    en: "Show punishment and action history.",
  },
  "mod.stats": {
    tr: "Yetkili işlem istatistiklerini gösterir.",
    en: "Show staff action statistics.",
  },
  "mod.jailsetup": {
    tr: "Karantina rolünü, kanalını ve kaldırılacak rolleri ayarlar.",
    en: "Configure the jail role, channel and roles to remove.",
  },
  "mod.case": {
    tr: "İşlem #{id}: {action} • {target} • {status}",
    en: "Case #{id}: {action} • {target} • {status}",
  },
  "mod.done": {
    tr: "İşlem tamamlandı. Kayıt #{id}",
    en: "Action completed. Case #{id}",
  },
  "mod.empty": { tr: "Kayıt bulunamadı.", en: "No records found." },
  "mod.noReason": { tr: "Sebep belirtilmedi.", en: "No reason provided." },
  "mod.duplicate": {
    tr: "Bu istek zaten işlendi. Kayıt #{id} ({status}).",
    en: "This request was already processed. Case #{id} ({status}).",
  },
  "mod.uncertain": {
    tr: "Discord sonucu doğrulanamadı. Tekrar denemeden önce #{id} kaydını ve sunucuyu kontrol edin.",
    en: "The Discord result could not be verified. Review case #{id} and the server before retrying.",
  },
  "mod.deleted": {
    tr: "{count} mesaj silindi. Eski mesajlar atlandı. Kayıt #{id}",
    en: "Deleted {count} messages. Old messages were skipped. Case #{id}",
  },
  "mod.jailConfig": {
    tr: "Önce .jailsetup @rol #kanal [kaldırılacak roller] ile yapılandırın.",
    en: "First configure .jailsetup @role #channel [roles to remove].",
  },
  "mod.jailConflict": {
    tr: "Karantina güvenli değil: Üyenin kalan rollerinde kanal erişim izni veya yönetici yetkisi var.",
    en: "Jail is unsafe: retained roles grant channel access or administrator permissions.",
  },
  "mod.jailActive": {
    tr: "Bu üyenin etkin veya tamamlanmamış karantina kaydı var.",
    en: "This member has an active or unfinished jail record.",
  },
  "mod.notJailed": {
    tr: "Bu üyenin karantina kaydı yok.",
    en: "This member has no jail record.",
  },
  "mod.locked": {
    tr: "Bu kanal zaten Executive tarafından kilitli.",
    en: "This channel is already locked by Executive.",
  },
  "mod.notLocked": {
    tr: "Kanal için Executive kilit kaydı bulunamadı.",
    en: "No Executive lock record exists for this channel.",
  },
  "mod.roleUnsafe": {
    tr: "Rol yönetilemiyor, çok yüksek veya tehlikeli yetkiler içeriyor.",
    en: "The role is unmanageable, too high, or grants dangerous permissions.",
  },
  "mod.jailConfigured": {
    tr: "Karantina yapılandırıldı. Yeni kanallar açılırsa .jailsetup komutunu tekrar çalıştırın.",
    en: "Jail configured. Run .jailsetup again after creating new channels.",
  },
  "mod.warning": {
    tr: "#{id} • {reason} • {moderator}",
    en: "#{id} • {reason} • {moderator}",
  },
  "mod.statsLine": {
    tr: "{moderator}: {count} başarılı işlem",
    en: "{moderator}: {count} successful actions",
  },
  "mod.historyTitle": {
    tr: "Son işlemler (en fazla 20)",
    en: "Recent actions (up to 20)",
  },
  "mod.status.pending": { tr: "bekliyor", en: "pending" },
  "mod.status.succeeded": { tr: "başarılı", en: "succeeded" },
  "mod.status.failed": { tr: "başarısız", en: "failed" },
  "mod.status.uncertain": {
    tr: "doğrulama gerekli",
    en: "requires verification",
  },
  "mod.restoration": {
    tr: "{count} rol güvenle geri verildi; {skipped} rol güvenlik veya silinme nedeniyle atlandı.",
    en: "Safely restored {count} roles; skipped {skipped} roles due to safety checks or deletion.",
  },
});
