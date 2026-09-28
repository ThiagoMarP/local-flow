// Only unambiguous spoken edits are handled here. Everything else can be
// reviewed once by the local model, with the original kept on rejection.
const TIME = "(?:uma|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|\\d{1,2}(?::\\d{2})?)";
const TIME_CORRECTION = new RegExp(
  `(?<![\\p{L}\\p{N}])(às|as)\\s+${TIME}\\s*(?:\\.+|…|[,;])\\s*(?:não\\s*,\\s*|quer dizer\\s*,?\\s*)(às|as)\\s+(${TIME})(?=$|[^\\p{L}\\p{N}])`,
  "giu",
);
const NUMBER_CORRECTION = /(?<![\p{L}\p{N}])(\d+(?:[.:/-]\d+)*)\s*(?:\.+|…|[,;])\s*(?:não\s*,\s*|quer dizer\s*,?\s*)(\d+(?:[.:/-]\d+)*)(?=$|[^\p{L}\p{N}])/giu;
const LIST_MARKER = /\b(primeiro|segundo|terceiro|quarto)\s*[:,]\s*/giu;
const ORDINALS = ["primeiro", "segundo", "terceiro", "quarto"];
const DATE_WORDS = "(?:hoje|amanhã|amanha|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)";
const DATE_CORRECTION = new RegExp(
  `(?<![\\p{L}\\p{N}])${DATE_WORDS}\\s*(?:\\.+|…|,)\\s*(?:quer dizer|corrigindo)\\s*,?\\s*(${DATE_WORDS})(?=\\s*(?:[.!?]|$))`,
  "giu",
);
const NOUN_CORRECTION = /(?<![\p{L}\p{N}])(o|a|os|as)\s+[\p{L}]{3,}\s*(?:\.+|…|,)\s*(?:quer dizer|corrigindo)\s*,?\s*(o|a|os|as)\s+([\p{L}]{3,})(?=$|[^\p{L}\p{N}])/giu;
const HESITANT_REPEAT = /(?<![\p{L}\p{N}])(eu|nós|você|vocês|ele|ela|preciso|quero|vamos)(?:\s*,\s*|\s+)\1(?=$|[^\p{L}\p{N}])/giu;

function formatExplicitList(input) {
  const markers = [...input.matchAll(LIST_MARKER)];
  if (markers.length < 2) return null;
  const prefix = input.slice(0, markers[0].index).trim();
  if (prefix && !prefix.endsWith(":")) return null;
  if (markers.some((marker, index) => marker[1].toLocaleLowerCase("pt-BR") !== ORDINALS[index])) {
    return null;
  }
  const items = markers.map((marker, index) => {
    const end = index + 1 < markers.length ? markers[index + 1].index : input.length;
    const segment = input.slice(marker.index + marker[0].length, end);
    if (index + 1 < markers.length && !/[;,.]\s*(?:e\s*)?$/iu.test(segment)) {
      return "";
    }
    const item = segment
      .trim()
      .replace(/[;,.]\s*(?:e\s*)?$/iu, "")
      .trim();
    return item ? item[0].toLocaleUpperCase("pt-BR") + item.slice(1) : "";
  });
  if (items.some((item) => !item)) return null;
  const lines = items.map((item, index) => `${index + 1}. ${item}`);
  if (/[.!?]\s*$/u.test(input)) lines[lines.length - 1] += ".";
  return `${prefix ? `${prefix}\n` : ""}${lines.join("\n")}`;
}

function applyLightFastPath(input) {
  const corrected = input
    .replace(TIME_CORRECTION, (_match, _oldHour, newHour, newTime) => `${newHour} ${newTime}`)
    .replace(NUMBER_CORRECTION, (_match, _oldNumber, newNumber) => newNumber)
    .replace(DATE_CORRECTION, (_match, newWord) => newWord)
    .replace(NOUN_CORRECTION, (_match, _oldArticle, newArticle, newNoun) =>
      `${newArticle} ${newNoun}`);
  const withoutRepeat = corrected.replace(HESITANT_REPEAT, (_match, word) => word);
  const list = formatExplicitList(withoutRepeat);
  if (list && list !== input) return { text: list, reason: "fast-list" };
  if (withoutRepeat !== corrected) {
    return { text: withoutRepeat, reason: corrected === input ? "fast-repetition" : "fast-correction" };
  }
  if (corrected !== input) return { text: corrected, reason: "fast-correction" };

  // A trailing edit command is safe only when sentence boundaries identify
  // exactly which sentence to remove.
  const deleteLast = input.match(/^(.+[.!?])\s+([^.!?]+[.!?])\s*(?:apaga|apague) a última frase[.!?]?\s*$/iu);
  if (deleteLast) return { text: deleteLast[1].trim(), reason: "fast-command" };
  return null;
}

module.exports = { applyLightFastPath, formatExplicitList };
