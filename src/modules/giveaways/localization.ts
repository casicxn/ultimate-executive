import { registerTranslations } from "../../core/localization.js";
registerTranslations({
  "community.ineligible": {
    tr: "Bu çekilişin katılım koşullarını karşılamıyorsun.",
    en: "You do not meet this giveaway’s eligibility requirements.",
  },
  "community.full": {
    tr: "Katılım sınırına ulaşıldı.",
    en: "The participation limit has been reached.",
  },
  "community.noWinners": {
    tr: "Yeniden çekiliş için uygun yeni katılımcı yok.",
    en: "No new eligible entrants are available for a reroll.",
  },
  "community.voteFixed": {
    tr: "Bu ankette oyun değiştirilemiyor.",
    en: "Votes cannot be changed in this poll.",
  },
  "community.join": { tr: "Katıl", en: "Join" },
  "community.leave": { tr: "Ayrıl", en: "Leave" },
  "community.joined": {
    tr: "Katılımın kaydedildi.",
    en: "Your participation is recorded.",
  },
  "community.left": {
    tr: "Katılımın kaldırıldı.",
    en: "Your participation is removed.",
  },
  "community.voted": { tr: "Oyun kaydedildi.", en: "Your vote is recorded." },
  "giveaway.title": { tr: "Çekiliş • {prize}", en: "Giveaway • {prize}" },
  "giveaway.body": {
    tr: "Düzenleyen: <@{organizer}>\nBitiş: <t:{ends}:F> (<t:{ends}:R>)\nKazanan sayısı: {count}\nKatılımcı: {entries}\nÖdül tesliminden düzenleyen sorumludur.",
    en: "Organizer: <@{organizer}>\nEnds: <t:{ends}:F> (<t:{ends}:R>)\nWinners: {count}\nEntrants: {entries}\nThe organizer is responsible for prize delivery.",
  },
  "giveaway.requirements": { tr: "Koşullar", en: "Requirements" },
  "giveaway.requirementsText": {
    tr: "Gerekli rol: {role}\nHesap yaşı: en az {days} gün\nSeviye: en az {level}",
    en: "Required role: {role}\nAccount age: at least {days} days\nLevel: at least {level}",
  },
  "giveaway.noRole": { tr: "Yok", en: "None" },
  "giveaway.results": {
    tr: "Tur {round} • Kazananlar",
    en: "Round {round} • Winners",
  },
  "giveaway.none": {
    tr: "Uygun kazanan bulunamadı.",
    en: "No eligible winners were found.",
  },
  "giveaway.desc": {
    tr: "Kalıcı ve koşullu katılımla çekiliş oluştur.",
    en: "Create a persistent giveaway with eligibility requirements.",
  },
  "giveaway.rerollDesc": {
    tr: "Çekilişte önceki kazananlar dışında yeni kazanan seç.",
    en: "Choose new winners excluding previous giveaway winners.",
  },
  "giveaway.historyDesc": {
    tr: "Bu sunucunun çekiliş geçmişini görüntüle.",
    en: "View this server’s giveaway history.",
  },
  "giveaway.history": { tr: "Çekiliş geçmişi", en: "Giveaway history" },
  "poll.title": { tr: "Anket • {question}", en: "Poll • {question}" },
  "poll.body": {
    tr: "Bitiş: <t:{ends}:R>\nOy sayısı: {votes}\nOy değiştirme: {change}\n{results}",
    en: "Ends: <t:{ends}:R>\nVotes: {votes}\nVote changes: {change}\n{results}",
  },
  "poll.allowed": { tr: "Açık", en: "Allowed" },
  "poll.fixed": { tr: "Kapalı", en: "Disabled" },
  "poll.ended": { tr: "Anket sona erdi.", en: "The poll has ended." },
  "poll.desc": {
    tr: "Süreli, kalıcı ve düğmeli anket oluştur.",
    en: "Create a timed, persistent button poll.",
  },
  "event.title": { tr: "Etkinlik • {title}", en: "Event • {title}" },
  "event.body": {
    tr: "Düzenleyen: <@{organizer}>\nBaşlangıç: <t:{starts}:F> (<t:{starts}:R>)\nKatılımcı: {count}\n\n{description}",
    en: "Organizer: <@{organizer}>\nStarts: <t:{starts}:F> (<t:{starts}:R>)\nAttending: {count}\n\n{description}",
  },
  "event.cancel": { tr: "Etkinliği iptal et", en: "Cancel event" },
  "event.reminder": {
    tr: "🔔 Etkinlik yaklaşıyor.",
    en: "🔔 The event is starting soon.",
  },
  "event.started": { tr: "Etkinlik başladı.", en: "The event has started." },
  "event.cancelled": {
    tr: "Etkinlik iptal edildi.",
    en: "The event was cancelled.",
  },
  "event.desc": {
    tr: "Katılım takibi ve kalıcı hatırlatmayla etkinlik planla.",
    en: "Schedule an event with RSVPs and a persistent reminder.",
  },
});
