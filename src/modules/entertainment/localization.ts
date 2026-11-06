import { registerTranslations } from "../../core/localization.js";
registerTranslations({
  "game.already": {
    tr: "Önce açık oyununu tamamla veya kapat.",
    en: "Finish or close your active game first.",
  },
  "game.stale": {
    tr: "Oyun güncellendi. En güncel düğmeyi kullan.",
    en: "The game changed. Use the latest button.",
  },
  "game.selected": {
    tr: "Seçimin zaten kaydedildi.",
    en: "Your selection is already recorded.",
  },
  "game.turn": { tr: "Şu anda sıra sende değil.", en: "It is not your turn." },
  "game.occupied": {
    tr: "Bu alan dolu. Başka bir hamle seç.",
    en: "That space is occupied. Choose another move.",
  },
  "game.duplicate": {
    tr: "Bu tahmini daha önce yaptın.",
    en: "You already tried that guess.",
  },
  "game.challenge": {
    tr: "{player} davet edildi. Oyuna başlamak için daveti kabul etmeli.",
    en: "{player} is invited and must accept to begin.",
  },
  "game.turnText": { tr: "Sıra: {player}", en: "Turn: {player}" },
  "game.won": { tr: "Kazanan: {player}", en: "Winner: {player}" },
  "game.lost": {
    tr: "Oyun bitti. Doğru cevap: {answer}",
    en: "Game over. Correct answer: {answer}",
  },
  "game.draw": { tr: "Berabere!", en: "Draw!" },
  "game.rejected": { tr: "Oyun kapatıldı.", en: "Game closed." },
  "game.expired": { tr: "Oyunun süresi doldu.", en: "The game expired." },
  "game.deadline": {
    tr: "Bitiş: <t:{time}:R> • Deneme: {moves}",
    en: "Ends: <t:{time}:R> • Attempts: {moves}",
  },
  "game.selectedText": {
    tr: "Seçim yapan oyuncu sayısı: {count}/{total}. Seçimler oyun bitene kadar gizlidir.",
    en: "Selections made: {count}/{total}. Choices stay hidden until the game ends.",
  },
  "game.rpsResult": { tr: "Seçimler: {choices}", en: "Choices: {choices}" },
  "game.rock": { tr: "Taş", en: "Rock" },
  "game.paper": { tr: "Kağıt", en: "Paper" },
  "game.scissors": { tr: "Makas", en: "Scissors" },
  "game.attack": { tr: "Saldır", en: "Attack" },
  "game.health": { tr: "Can puanları: {health}", en: "Health: {health}" },
  "game.guess": { tr: "Tahmin et", en: "Make a guess" },
  "game.guessLabel": { tr: "Tahminin", en: "Your guess" },
  "game.guessPlaceholder": { tr: "Bir cevap yaz", en: "Enter your answer" },
  "game.numberText": {
    tr: "1–100 arasında bir sayı tuttum. 7 tahmin hakkın var.",
    en: "I picked a number from 1 to 100. You have 7 guesses.",
  },
  "game.higher": {
    tr: "Daha büyük bir sayı dene.",
    en: "Try a higher number.",
  },
  "game.lower": { tr: "Daha küçük bir sayı dene.", en: "Try a lower number." },
  "game.wrong": {
    tr: "Henüz doğru değil. Tekrar dene.",
    en: "Not correct yet. Try again.",
  },
  "game.scramble": {
    tr: "Karışık harflerden kelimeyi bul: **{letters}**\n5 tahmin hakkın var.",
    en: "Unscramble the word: **{letters}**\nYou have 5 guesses.",
  },
  "game.hangmanText": {
    tr: "Bir harf veya kelimenin tamamını tahmin et. 6 yanlış hakkın var.\n**{mask}**\nDenenenler: {guesses}",
    en: "Guess a letter or the whole word. You may make 6 wrong guesses.\n**{mask}**\nTried: {guesses}",
  },
  "game.title.tkm": { tr: "Taş Kağıt Makas", en: "Rock Paper Scissors" },
  "game.title.xox": { tr: "XOX", en: "Tic Tac Toe" },
  "game.title.connect4": { tr: "Dört Birleştir", en: "Connect Four" },
  "game.title.quiz": { tr: "Bilgi Yarışması", en: "Quiz" },
  "game.title.kelime": { tr: "Karışık Kelime", en: "Word Scramble" },
  "game.title.adamasmaca": { tr: "Adam Asmaca", en: "Hangman" },
  "game.title.duello": { tr: "Sanal Düello", en: "Virtual Duel" },
  "game.title.sayi": { tr: "Sayı Tahmini", en: "Number Guessing" },
  "game.title.tahmin": { tr: "Sayı Tahmini", en: "Number Guessing" },
  "game.title.emoji": { tr: "Emoji Bulmacası", en: "Emoji Puzzle" },
  "game.flip": { tr: "Sonuç: **{result}**", en: "Result: **{result}**" },
  "game.heads": { tr: "Yazı", en: "Heads" },
  "game.tails": { tr: "Tura", en: "Tails" },
  "game.dice": {
    tr: "Zarlar ({sides} yüz): **{result}**",
    en: "Dice ({sides} sides): **{result}**",
  },
  "game.ball0": { tr: "Kesinlikle evet.", en: "Definitely yes." },
  "game.ball1": { tr: "Büyük olasılıkla.", en: "Very likely." },
  "game.ball2": { tr: "Şimdilik belirsiz.", en: "Uncertain for now." },
  "game.ball3": { tr: "Biraz sonra tekrar sor.", en: "Ask again later." },
  "game.ball4": { tr: "Pek olası görünmüyor.", en: "It does not look likely." },
  "game.ball5": { tr: "Hayır.", en: "No." },
  "game.desc.tkm": {
    tr: "Botla veya davet ettiğin oyuncuyla taş kağıt makas oyna.",
    en: "Play rock paper scissors against the bot or an invited player.",
  },
  "game.desc.xox": {
    tr: "Bir oyuncuyu XOX oyununa davet et.",
    en: "Invite a player to tic tac toe.",
  },
  "game.desc.connect4": {
    tr: "Bir oyuncuyu dört birleştir oyununa davet et.",
    en: "Invite a player to Connect Four.",
  },
  "game.desc.quiz": {
    tr: "Yerel soru bankasından bilgi yarışması başlat.",
    en: "Start a quiz using the local question bank.",
  },
  "game.desc.kelime": {
    tr: "Karışık harflerden kelimeyi bul.",
    en: "Unscramble a word.",
  },
  "game.desc.adamasmaca": {
    tr: "Harf veya kelime tahmini yaparak kazan.",
    en: "Win by guessing letters or the whole word.",
  },
  "game.desc.duello": {
    tr: "Bir oyuncuyla sıra tabanlı sanal düello yap.",
    en: "Play a turn-based virtual duel with a player.",
  },
  "game.desc.sayi": {
    tr: "Yedi tahminde gizli sayıyı bul.",
    en: "Find the hidden number within seven guesses.",
  },
  "game.desc.emoji": {
    tr: "Emoji bulmacasını çöz.",
    en: "Solve an emoji puzzle.",
  },
  "game.desc.yazitura": {
    tr: "Sanal yazı tura at.",
    en: "Flip a virtual coin.",
  },
  "game.desc.zar": {
    tr: "Bir veya birkaç sanal zar at.",
    en: "Roll one or several virtual dice.",
  },
  "game.desc.8ball": {
    tr: "Eğlencelik bir soruya rastgele cevap al.",
    en: "Receive a random answer to a question for fun.",
  },
});
