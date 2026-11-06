import type { Locale } from "../../core/localization.js";

export type QuizCategory =
  "general" | "technology" | "gaming" | "science" | "geography" | "history";
export interface Question {
  id: string;
  category: QuizCategory;
  text: Record<Locale, string>;
  options: Record<Locale, readonly string[]>;
  answer: number;
}
// Local, original questions. Add matching TR/EN options and a zero-based answer.
export const questions: readonly Question[] = [
  {
    id: "general-1",
    category: "general",
    text: {
      tr: "Bir satranç tahtasında kaç kare vardır?",
      en: "How many squares are on a chessboard?",
    },
    options: { tr: ["32", "48", "64", "80"], en: ["32", "48", "64", "80"] },
    answer: 2,
  },
  {
    id: "general-2",
    category: "general",
    text: {
      tr: "Artık yılda Şubat kaç gündür?",
      en: "How many days are in February during a leap year?",
    },
    options: { tr: ["27", "28", "29", "30"], en: ["27", "28", "29", "30"] },
    answer: 2,
  },
  {
    id: "technology-1",
    category: "technology",
    text: {
      tr: "İkili sayı sistemi hangi rakamları kullanır?",
      en: "Which digits does the binary number system use?",
    },
    options: {
      tr: ["0 ve 1", "1 ve 2", "0 ve 9", "2 ve 8"],
      en: ["0 and 1", "1 and 2", "0 and 9", "2 and 8"],
    },
    answer: 0,
  },
  {
    id: "technology-2",
    category: "technology",
    text: {
      tr: "HTML esas olarak neyi tanımlar?",
      en: "What does HTML primarily describe?",
    },
    options: {
      tr: [
        "Ağ şifrelemesi",
        "Web sayfası yapısı",
        "İşlemci hızı",
        "Ses dalgaları",
      ],
      en: [
        "Network encryption",
        "Web page structure",
        "CPU speed",
        "Sound waves",
      ],
    },
    answer: 1,
  },
  {
    id: "gaming-1",
    category: "gaming",
    text: {
      tr: "Satrançta hangi taş L şeklinde hareket eder?",
      en: "Which chess piece moves in an L shape?",
    },
    options: {
      tr: ["Fil", "Kale", "At", "Vezir"],
      en: ["Bishop", "Rook", "Knight", "Queen"],
    },
    answer: 2,
  },
  {
    id: "gaming-2",
    category: "gaming",
    text: {
      tr: "Klasik Tetris parçaları kaç kareden oluşur?",
      en: "How many squares make up a classic Tetris piece?",
    },
    options: { tr: ["2", "3", "4", "5"], en: ["2", "3", "4", "5"] },
    answer: 2,
  },
  {
    id: "science-1",
    category: "science",
    text: {
      tr: "Suyun kimyasal formülü nedir?",
      en: "What is the chemical formula of water?",
    },
    options: {
      tr: ["CO₂", "H₂O", "O₂", "NaCl"],
      en: ["CO₂", "H₂O", "O₂", "NaCl"],
    },
    answer: 1,
  },
  {
    id: "science-2",
    category: "science",
    text: {
      tr: "Bitkiler fotosentez sırasında hangi gazı açığa çıkarır?",
      en: "Which gas do plants release during photosynthesis?",
    },
    options: {
      tr: ["Helyum", "Azot", "Oksijen", "Hidrojen"],
      en: ["Helium", "Nitrogen", "Oxygen", "Hydrogen"],
    },
    answer: 2,
  },
  {
    id: "geography-1",
    category: "geography",
    text: {
      tr: "Japonya hangi kıtadadır?",
      en: "On which continent is Japan located?",
    },
    options: {
      tr: ["Avrupa", "Asya", "Afrika", "Güney Amerika"],
      en: ["Europe", "Asia", "Africa", "South America"],
    },
    answer: 1,
  },
  {
    id: "geography-2",
    category: "geography",
    text: {
      tr: "En büyük okyanus hangisidir?",
      en: "Which is the largest ocean?",
    },
    options: {
      tr: ["Atlantik", "Hint", "Arktik", "Pasifik"],
      en: ["Atlantic", "Indian", "Arctic", "Pacific"],
    },
    answer: 3,
  },
  {
    id: "history-1",
    category: "history",
    text: {
      tr: "Türkiye Cumhuriyeti hangi yılda ilan edildi?",
      en: "In which year was the Republic of Türkiye proclaimed?",
    },
    options: {
      tr: ["1919", "1920", "1923", "1938"],
      en: ["1919", "1920", "1923", "1938"],
    },
    answer: 2,
  },
  {
    id: "history-2",
    category: "history",
    text: {
      tr: "Antik piramitleriyle bilinen uygarlık hangisidir?",
      en: "Which civilization is known for its ancient pyramids at Giza?",
    },
    options: {
      tr: ["Antik Mısır", "Vikingler", "Aztekler", "Romalılar"],
      en: ["Ancient Egypt", "Vikings", "Aztecs", "Romans"],
    },
    answer: 0,
  },
];

export const words: Record<Locale, readonly string[]> = {
  tr: [
    "gezegen",
    "bilgisayar",
    "kütüphane",
    "kelebek",
    "pencere",
    "yıldız",
    "okyanus",
    "mühendis",
  ],
  en: [
    "planet",
    "computer",
    "library",
    "butterfly",
    "window",
    "galaxy",
    "ocean",
    "engineer",
  ],
};

export const emojiQuestions = [
  {
    emoji: "🌧️ + 🌈",
    text: {
      tr: "Yağmurdan sonra gökyüzünde ne oluşabilir?",
      en: "What may appear in the sky after rain?",
    },
    options: {
      tr: ["Gökkuşağı", "Volkan", "Çöl", "Buzul"],
      en: ["Rainbow", "Volcano", "Desert", "Glacier"],
    },
    answer: 0,
  },
  {
    emoji: "🍯 + 🐝",
    text: {
      tr: "Bu emojiler hangi canlıyı anlatıyor?",
      en: "Which creature do these emojis suggest?",
    },
    options: {
      tr: ["Karınca", "Bal arısı", "Kelebek", "Örümcek"],
      en: ["Ant", "Honeybee", "Butterfly", "Spider"],
    },
    answer: 1,
  },
  {
    emoji: "📚 + 🏫",
    text: {
      tr: "Bu emojiler hangi yeri anlatıyor?",
      en: "Which place do these emojis suggest?",
    },
    options: {
      tr: ["Hastane", "Garaj", "Okul", "Havalimanı"],
      en: ["Hospital", "Garage", "School", "Airport"],
    },
    answer: 2,
  },
] as const;
