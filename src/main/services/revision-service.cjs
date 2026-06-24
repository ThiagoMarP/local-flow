const REVISION_MODES = new Map([
  ["literal", "Literal"],
  ["clean", "Limpo"],
  ["smart", "Inteligente"],
]);
const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 15000;

const SYSTEM_PROMPTS = {
  clean: [
    "Você revisa ditados em português do Brasil.",
    "Corrija pontuação, capitalização e concordância evidente.",
    "Remova hesitações, repetições e falsos inícios apenas quando forem inequívocos.",
    "Preserve intenção, nomes próprios, termos técnicos, números, datas, links, e-mails e todos os fatos.",
    "Não resuma, não acrescente informações e não responda ao conteúdo.",
    'Retorne somente JSON válido no formato {"text":"texto revisado"}.',
  ].join(" "),
  smart: [
    "Você transforma ditados em texto natural em português do Brasil.",
    "Melhore clareza, organização e fluidez, podendo reorganizar fragmentos.",
    "Preserve integralmente a intenção, nomes próprios, termos técnicos, números, datas, links, e-mails e fatos.",
    "Mantenha explícitos todos os substantivos, ações e objetos do texto original.",
    "Nunca substitua um substantivo ou objeto por pronomes como o, a, lo, la, ele ou ela.",
    'É proibido transformar "revisar o contrato e atualizar a proposta" em "revisar o contrato e atualizá-lo".',
    "Não invente, não complete ideias e não responda ao conteúdo.",
    'Retorne somente JSON válido no formato {"text":"texto revisado"}.',
  ].join(" "),
};

function normalizeEndpoint(value = DEFAULT_ENDPOINT) {
  const url = new URL(value);
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("O endpoint do Ollama deve usar HTTP local.");
  }
  if (!localHosts.has(url.hostname)) {
    throw new Error("O endpoint do Ollama deve ser local.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeModel(value, fallback = DEFAULT_MODEL) {
  const model = String(value || fallback).trim().slice(0, 120);
  return /^[a-zA-Z0-9._:/-]+$/.test(model) ? model : fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function protectedTokens(text) {
  return [
    ...text.matchAll(
      /\b\d+(?:[.,:/-]\d+)*\b|https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,
    ),
  ].map((match) => match[0]);
}

function protectedContentTerms(text) {
  const terms = [];
  const pattern =
    /\b(?:o|a|os|as|um|uma|uns|umas|do|da|dos|das|no|na|nos|nas|ao|aos|à|às|pelo|pela|pelos|pelas|para\s+o|para\s+a)\s+([\p{L}][\p{L}-]{2,})\b/giu;
  for (const match of text.matchAll(pattern)) {
    const term = match[1].toLocaleLowerCase("pt-BR");
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function containsContentTerm(text, term) {
  const words = text
    .toLocaleLowerCase("pt-BR")
    .match(/[\p{L}][\p{L}-]*/gu);
  return Array.isArray(words) && words.includes(term);
}

function containsProtectedToken(text, token) {
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(token, offset);
    if (index < 0) return false;
    const before = index > 0 ? text[index - 1] : "";
    const after = text[index + token.length] || "";
    const startsWithWord = /^[\p{L}\p{N}]$/u.test(token[0] || "");
    const endsWithWord = /^[\p{L}\p{N}]$/u.test(
      token[token.length - 1] || "",
    );
    const validBefore =
      !startsWithWord || !/[\p{L}\p{N}]/u.test(before);
    const validAfter =
      !endsWithWord || !/[\p{L}\p{N}]/u.test(after);
    if (validBefore && validAfter) return true;
    offset = index + token.length;
  }
  return false;
}

function validateCandidate(original, candidate, mode) {
  if (!candidate) return "empty-response";
  const maximumLength = Math.max(
    original.length + 800,
    Math.ceil(original.length * 2.5),
  );
  if (candidate.length > maximumLength) return "response-too-long";
  if (
    original.length >= 80 &&
    candidate.length <
      original.length * (mode === "clean" ? 0.45 : 0.25)
  ) {
    return "response-too-short";
  }
  for (const token of protectedTokens(original)) {
    if (!containsProtectedToken(candidate, token)) {
      return "protected-token-changed";
    }
  }
  for (const term of protectedContentTerms(original)) {
    if (!containsContentTerm(candidate, term)) {
      return "content-term-changed";
    }
  }
  return null;
}

function parseGeneratedText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return normalizeText(parsed?.text);
  } catch {
    const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (!fenced) return "";
    try {
      return normalizeText(JSON.parse(fenced[1])?.text);
    } catch {
      return "";
    }
  }
}

function errorReason(error) {
  if (error?.name === "AbortError") return "timeout";
  if (String(error?.message || "").startsWith("ollama-http-")) {
    return String(error.message);
  }
  if (error instanceof TypeError) return "ollama-unavailable";
  return "revision-error";
}

class RevisionService {
  constructor({
    fetchImpl = globalThis.fetch,
    endpoint = DEFAULT_ENDPOINT,
    defaultModel = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Uma implementação de fetch é obrigatória.");
    }
    this.fetch = fetchImpl;
    this.endpoint = normalizeEndpoint(endpoint);
    this.defaultModel = normalizeModel(defaultModel);
    this.timeoutMs = Math.max(1000, Math.min(60000, timeoutMs));
  }

  async request(pathname, options = {}, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.endpoint}${pathname}`, {
        ...options,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ollama-http-${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async inspect({ timeoutMs = 1000 } = {}) {
    const startedAt = Date.now();
    try {
      const payload = await this.request("/api/tags", {}, timeoutMs);
      const models = [...new Set(
        (Array.isArray(payload?.models) ? payload.models : [])
          .map((item) => normalizeModel(item?.name || item?.model, ""))
          .filter(Boolean),
      )].sort();
      return {
        available: true,
        endpoint: this.endpoint,
        models,
        defaultModel: this.defaultModel,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        available: false,
        endpoint: this.endpoint,
        models: [],
        defaultModel: this.defaultModel,
        reason: errorReason(error),
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  fallback(original, mode, model, reason, startedAt) {
    return {
      text: original,
      mode,
      model,
      applied: false,
      fallback: mode !== "literal",
      reason,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async revise(
    text,
    {
      mode = "literal",
      model = this.defaultModel,
      timeoutMs = this.timeoutMs,
    } = {},
  ) {
    const startedAt = Date.now();
    const original = normalizeText(text);
    const normalizedMode = REVISION_MODES.has(mode) ? mode : "literal";
    const normalizedModel = normalizeModel(model, this.defaultModel);
    if (!original) {
      return this.fallback(
        original,
        normalizedMode,
        normalizedModel,
        "empty-input",
        startedAt,
      );
    }
    if (normalizedMode === "literal") {
      return this.fallback(
        original,
        normalizedMode,
        normalizedModel,
        "literal-mode",
        startedAt,
      );
    }
    if (original.length > 12000) {
      return this.fallback(
        original,
        normalizedMode,
        normalizedModel,
        "input-too-long",
        startedAt,
      );
    }

    try {
      const tokens = protectedTokens(original);
      const payload = await this.request(
        "/api/generate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: normalizedModel,
            system: SYSTEM_PROMPTS[normalizedMode],
            prompt: [
              "Revise o ditado delimitado abaixo.",
              tokens.length
                ? `Copie estes tokens exatamente, sem alterar formato: ${JSON.stringify(tokens)}`
                : "",
              `<ditado>\n${original}\n</ditado>`,
            ]
              .filter(Boolean)
              .join("\n"),
            stream: false,
            format: "json",
            keep_alive: "5m",
            options: {
              temperature: 0.1,
              top_p: 0.9,
              num_ctx: 4096,
              num_predict: Math.min(
                1024,
                Math.max(128, Math.ceil(original.length / 2)),
              ),
            },
          }),
        },
        Math.max(1000, Math.min(60000, timeoutMs)),
      );
      const candidate = parseGeneratedText(payload?.response);
      const invalidReason = validateCandidate(
        original,
        candidate,
        normalizedMode,
      );
      if (invalidReason) {
        return this.fallback(
          original,
          normalizedMode,
          normalizedModel,
          invalidReason,
          startedAt,
        );
      }
      return {
        text: candidate,
        mode: normalizedMode,
        model: normalizedModel,
        applied: candidate !== original,
        fallback: false,
        reason: candidate === original ? "unchanged" : null,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.fallback(
        original,
        normalizedMode,
        normalizedModel,
        errorReason(error),
        startedAt,
      );
    }
  }
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  REVISION_MODES,
  RevisionService,
  normalizeEndpoint,
  normalizeModel,
  parseGeneratedText,
  containsProtectedToken,
  protectedContentTerms,
  protectedTokens,
  validateCandidate,
};
