// Parakeet v3 picks the language on its own and cannot be pinned to Portuguese.
// Sometimes it decides a Brazilian Portuguese dictation is English and maps the
// sounds onto English words. Function words give that away: technical terms
// (API, token, Electron) are not in these lists, so a Portuguese sentence full
// of jargon still reads as Portuguese.

// Words that are not also common Portuguese words. "a", "no", "do", "for",
// "come" and "more" are left out on purpose.
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "of", "to", "is", "was", "were", "are", "be", "been",
  "he", "she", "they", "we", "you", "it", "i", "my", "your", "his", "her",
  "their", "our", "that", "this", "those", "these", "with", "have", "has",
  "had", "in", "on", "at", "from", "by", "or", "if", "but", "not", "just",
  "what", "which", "would", "will", "there", "an", "about", "into",
]);

const PORTUGUESE_FUNCTION_WORDS = new Set([
  "o", "e", "de", "que", "não", "pra", "para", "com", "um", "uma", "eu",
  "você", "ele", "ela", "isso", "esse", "essa", "está", "tá", "mas", "mais",
  "muito", "também", "meu", "minha", "os", "das", "dos", "na", "em", "por",
  "se", "é", "foi", "vai", "tem", "estou", "aqui", "agora", "então", "já",
  "da", "ao", "nos", "nas", "como", "quando", "porque", "sobre", "gente",
]);

const MIN_ENGLISH_HITS = 3;

// Parakeet also knows Russian, Ukrainian, Bulgarian and Greek. On short
// dictations it can pick one of them ("e pode seguir" came out as "Ипоти").
// Portuguese never uses these alphabets, so a single letter is enough.
const FOREIGN_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

function countFunctionWords(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^\p{L}']+/u)
    .filter(Boolean);
  let englishHits = 0;
  let portugueseHits = 0;
  for (const word of words) {
    if (ENGLISH_FUNCTION_WORDS.has(word)) englishHits += 1;
    if (PORTUGUESE_FUNCTION_WORDS.has(word)) portugueseHits += 1;
  }
  return { englishHits, portugueseHits };
}

function looksLikeLanguageDrift(text) {
  const counts = countFunctionWords(text);
  const foreignScript = FOREIGN_SCRIPT.test(String(text || ""));
  return {
    ...counts,
    foreignScript,
    drifted:
      foreignScript ||
      (counts.englishHits >= MIN_ENGLISH_HITS &&
        counts.englishHits > counts.portugueseHits),
  };
}

module.exports = { countFunctionWords, looksLikeLanguageDrift };
