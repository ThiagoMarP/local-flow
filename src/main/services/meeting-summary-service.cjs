// Meeting summary (Fase C, revisado). Lê a transcrição rotulada
// ([Você]/[Chamada]) e pede ao Ollama local uma ATA estruturada em Markdown
// (resumo executivo, tópicos, decisões, action items, questões em aberto). É um
// caminho SEPARADO do revision-service.cjs, que é proibido de resumir.
//
// A saída é Markdown direto (não JSON): para uma ata rica com checkboxes e
// responsáveis, deixar o modelo formatar é mais natural e fiel do que montar a
// partir de um JSON.

const {
  normalizeEndpoint,
  normalizeModel,
} = require("./revision-service.cjs");

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_TIMEOUT_MS = 45000;

// A meeting transcript can be long: a fixed 8192-token context silently cut
// the start of a ~40 min meeting, and a fixed 45 s limit failed it even on a
// 3B model. Size both from the transcript (pt-BR runs ~3 chars per token;
// estimating low only makes the context a bit larger). Summaries run in the
// background, so a long wait is acceptable.
const CHARS_PER_TOKEN = 3;
const PROMPT_AND_OUTPUT_TOKENS = 2500;
const MIN_CONTEXT = 8192;
const MAX_CONTEXT = 32768;
const BASE_TIMEOUT_MS = 90000;
const TIMEOUT_PER_TOKEN_MS = 25;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

function summaryBudget(text) {
  const tokens = Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
  const needed = Math.ceil((tokens + PROMPT_AND_OUTPUT_TOKENS) / 1024) * 1024;
  return {
    numCtx: Math.max(MIN_CONTEXT, Math.min(MAX_CONTEXT, needed)),
    timeoutMs: Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + tokens * TIMEOUT_PER_TOKEN_MS),
  };
}

const SYSTEM_PROMPT = [
  "Você é um assistente executivo sênior especializado em analisar transcrições de reuniões e extrair informações acionáveis de forma clara e objetiva.",
  "A transcrição vem com falas rotuladas: [Você] é o usuário; [Chamada] são as outras pessoas da conversa.",
  "Leia a transcrição e gere uma ata estruturada, ignorando conversas informais, interrupções, palavras de preenchimento e assuntos fora do escopo.",
  "Gere a ata ESTRITAMENTE neste formato Markdown:",
  "",
  "# Ata da Reunião",
  "",
  "## Resumo Executivo",
  "[parágrafo conciso, no máximo 4 linhas, com o objetivo principal e o resultado geral]",
  "",
  "## Principais Tópicos Discutidos",
  "* [Tópico]: [contexto, agrupando falas fragmentadas em conceitos completos]",
  "",
  "## Decisões Tomadas",
  "* [decisão final ou consenso]",
  "",
  "## Próximos Passos (Action Items)",
  "* [ ] [Ação] — [Responsável: Você, Chamada ou o nome citado; se não estiver claro, A definir] — [Prazo, se houver]",
  "",
  "## Questões em Aberto / Bloqueios",
  "* [dúvida não resolvida ou problema que trava o progresso]",
  "",
  "REGRAS ESTRITAS:",
  "1. NÃO invente informações (zero alucinação). Baseie-se APENAS no texto fornecido.",
  "2. Se uma seção não tiver conteúdo correspondente, mantenha o título e escreva: Não aplicável para esta reunião.",
  "3. Em Decisões, se nada foi decidido, escreva: Nenhuma decisão formal foi registrada nesta sessão.",
  "4. Tom profissional e direto. Responda SOMENTE com a ata em Markdown, sem nenhum comentário antes ou depois.",
].join("\n");

function normalizeText(value) {
  return String(value || "").trim();
}

// Limpa a resposta do modelo: remove uma cerca de código que envolva tudo e um
// possível preâmbulo antes do primeiro título.
function cleanMarkdown(value) {
  let text = normalizeText(value);
  if (!text) return "";
  const fenced = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  const headingAt = text.search(/^#{1,3}\s/m);
  if (headingAt > 0) text = text.slice(headingAt).trim();
  return text;
}

function errorReason(error) {
  if (error?.name === "AbortError") return "timeout";
  if (error instanceof TypeError) return "ollama-unavailable";
  return "summary-error";
}

class MeetingSummaryService {
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
    this.timeoutMs = Math.max(1000, Math.min(MAX_TIMEOUT_MS, timeoutMs));
  }

  fallback(reason, model, startedAt) {
    return {
      applied: false,
      fallback: true,
      reason,
      markdown: null,
      model,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async summarize(
    transcript,
    { model = this.defaultModel, timeoutMs = this.timeoutMs } = {},
  ) {
    const startedAt = Date.now();
    const text = normalizeText(transcript);
    const normalizedModel = normalizeModel(model, this.defaultModel);
    if (!text) return this.fallback("empty-input", normalizedModel, startedAt);

    const budget = summaryBudget(text);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(MAX_TIMEOUT_MS, Math.max(1000, timeoutMs, budget.timeoutMs)),
    );
    try {
      const response = await this.fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: normalizedModel,
          system: SYSTEM_PROMPT,
          prompt: `Transcrição da reunião:\n<transcricao>\n${text}\n</transcricao>`,
          stream: false,
          keep_alive: "5m",
          // Thinking models (Qwen3.5) would reason first and take far longer.
          think: false,
          options: { temperature: 0.2, top_p: 0.9, num_ctx: budget.numCtx },
        }),
      });
      if (!response.ok) {
        return this.fallback(
          `ollama-http-${response.status}`,
          normalizedModel,
          startedAt,
        );
      }
      const payload = await response.json();
      const markdown = cleanMarkdown(payload?.response);
      if (!markdown || !/^#{1,3}\s/m.test(markdown)) {
        return this.fallback("invalid-response", normalizedModel, startedAt);
      }
      return {
        applied: true,
        fallback: false,
        reason: null,
        markdown,
        model: normalizedModel,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.fallback(errorReason(error), normalizedModel, startedAt);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  MeetingSummaryService,
  cleanMarkdown,
  summaryBudget,
};
