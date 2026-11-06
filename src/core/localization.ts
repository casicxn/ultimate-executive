export type Locale = "tr" | "en";
export const DEVELOPER_CREDIT = "Developed by Casi";
export type Dictionary = Record<string, { tr: string; en: string }>;
const dictionary: Dictionary = {
  "error.permission": {
    tr: "Bu işlem için yetkiniz yok.",
    en: "You are not authorized for this action.",
  },
  "error.input": {
    tr: "Geçersiz giriş. Kullanımı kontrol edin.",
    en: "Invalid input. Check the usage.",
  },
  "error.disabled": {
    tr: "Bu modül veya komut devre dışı.",
    en: "This module or command is disabled.",
  },
  "error.cooldown": {
    tr: "Lütfen {seconds} saniye bekleyin.",
    en: "Please wait {seconds} seconds.",
  },
  "error.internal": {
    tr: "İşlem tamamlanamadı. Kayıt: {id}",
    en: "The operation could not be completed. Reference: {id}",
  },
  "error.expired": {
    tr: "Bu etkileşim sona erdi.",
    en: "This interaction has expired.",
  },
  "common.ok": { tr: "İşlem kaydedildi.", en: "Changes saved." },
  "common.cancel": { tr: "İptal", en: "Cancel" },
  "common.accept": { tr: "Kabul et", en: "Accept" },
  "common.reject": { tr: "Reddet", en: "Reject" },
  branding: { tr: DEVELOPER_CREDIT, en: DEVELOPER_CREDIT },
};
export function registerTranslations(entries: Dictionary): void {
  for (const [key, value] of Object.entries(entries)) {
    if (dictionary[key]) throw new Error(`Duplicate translation: ${key}`);
    dictionary[key] = value;
  }
}
export function t(
  locale: Locale,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const entry = dictionary[key];
  if (!entry) return key;
  return entry[locale].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}
export function translations(): Dictionary {
  return dictionary;
}
