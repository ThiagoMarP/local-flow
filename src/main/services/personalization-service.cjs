const WRITING_PROFILES = new Map([
  [
    "neutral",
    {
      label: "Neutro",
      instruction: "",
    },
  ],
  [
    "concise",
    {
      label: "Conciso",
      instruction:
        "Prefira frases curtas e diretas, removendo redundâncias sem remover fatos.",
    },
  ],
  [
    "professional",
    {
      label: "Profissional",
      instruction:
        "Use tom profissional, claro e respeitoso, sem linguagem rebuscada.",
    },
  ],
  [
    "casual",
    {
      label: "Casual",
      instruction:
        "Use tom natural e conversacional, preservando clareza e conteúdo.",
    },
  ],
]);

function normalizePairs(
  value,
  {
    sourceKey,
    targetKey,
    limit,
    sourceLimit = 120,
    targetLimit,
    allowEmptyTarget = false,
  },
) {
  if (!Array.isArray(value)) return [];
  const pairs = [];
  const seen = new Set();
  for (const item of value) {
    const source = String(item?.[sourceKey] || "")
      .trim()
      .slice(0, sourceLimit);
    const target = String(item?.[targetKey] ?? "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, targetLimit);
    const key = source.toLocaleLowerCase("pt-BR");
    if (
      !source ||
      (!allowEmptyTarget && !target) ||
      seen.has(key) ||
      source === target
    ) {
      continue;
    }
    seen.add(key);
    pairs.push({ [sourceKey]: source, [targetKey]: target });
    if (pairs.length >= limit) break;
  }
  return pairs;
}

function normalizeReplacements(value) {
  return normalizePairs(value, {
    sourceKey: "from",
    targetKey: "to",
    limit: 100,
    targetLimit: 500,
    allowEmptyTarget: true,
  });
}

function normalizeSnippets(value) {
  return normalizePairs(value, {
    sourceKey: "trigger",
    targetKey: "expansion",
    limit: 50,
    targetLimit: 4000,
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rulePattern(source) {
  const escaped = escapeRegExp(source).replace(/\s+/g, "\\s+");
  const startsWithWord = /^[\p{L}\p{N}]/u.test(source);
  const endsWithWord = /[\p{L}\p{N}]$/u.test(source);
  return new RegExp(
    `${startsWithWord ? "(?<![\\p{L}\\p{N}])" : ""}${escaped}${endsWithWord ? "(?![\\p{L}\\p{N}])" : ""}`,
    "giu",
  );
}

function applyRules(text, rules, sourceKey, targetKey) {
  let output = String(text || "");
  const markers = [];
  let applied = 0;
  const sorted = [...rules].sort(
    (left, right) =>
      right[sourceKey].length - left[sourceKey].length,
  );

  for (const [index, rule] of sorted.entries()) {
    const marker = `\uE000LF${index}\uE001`;
    let matches = 0;
    output = output.replace(rulePattern(rule[sourceKey]), () => {
      matches += 1;
      return marker;
    });
    if (matches > 0) {
      markers.push({ marker, value: rule[targetKey] });
      applied += matches;
    }
  }
  for (const { marker, value } of markers) {
    output = output.replaceAll(marker, value);
  }
  return { text: output, applied };
}

function resolvePersonalizationOptions(payload = {}, settings = {}) {
  return {
    writingProfile:
      payload.writingProfile || settings.writingProfile || "neutral",
    replacements: Array.isArray(payload.replacements)
      ? payload.replacements
      : settings.replacements || [],
    snippets: Array.isArray(payload.snippets)
      ? payload.snippets
      : settings.snippets || [],
  };
}

class PersonalizationService {
  applyReplacements(text, rules) {
    const result = applyRules(
      text,
      normalizeReplacements(rules),
      "from",
      "to",
    );
    result.text = result.text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([,.;!?])/g, "$1");
    return result;
  }

  expandSnippets(text, snippets) {
    return applyRules(
      text,
      normalizeSnippets(snippets),
      "trigger",
      "expansion",
    );
  }

  writingInstruction(profile) {
    return (
      WRITING_PROFILES.get(profile) ||
      WRITING_PROFILES.get("neutral")
    ).instruction;
  }
}

module.exports = {
  PersonalizationService,
  WRITING_PROFILES,
  applyRules,
  normalizeReplacements,
  normalizeSnippets,
  resolvePersonalizationOptions,
  rulePattern,
};
