import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RevisionService } = require("../src/main/services/revision-service.cjs");

const service = new RevisionService({ timeoutMs: 30000 });
const status = await service.inspect({ timeoutMs: 1500 });
const cases = [
  { id: "horario", text: "A reunião é às duas… não, às três.", fast: true },
  { id: "numero", text: "O orçamento é 200… não, 300 reais.", fast: true },
  { id: "lista", text: "Primeiro, comprar pão; segundo, ligar para Ana.", fast: true },
  { id: "comando", text: "Envie o relatório. O prazo é sexta. Apague a última frase.", fast: true },
  { id: "hesitacao", text: "Então, preciso enviar o relatório amanhã.", fast: false },
  { id: "correcao", text: "O prazo é amanhã, quer dizer, sexta.", fast: true },
  { id: "negacao", text: "Não quero falar sobre esse assunto.", fast: false },
];

const results = [];
for (const item of cases) {
  const literal = await service.revise(item.text, { mode: "literal" });
  if (!item.fast && !status.available) {
    results.push({ id: item.id, skipped: "ollama-unavailable" });
    continue;
  }
  const light = await service.revise(item.text, { mode: "light", timeoutMs: 30000 });
  results.push({
    id: item.id,
    original: item.text,
    result: light.text,
    literalMs: literal.elapsedMs,
    lightMs: light.elapsedMs,
    path: light.path,
    fallback: light.fallback,
    reason: light.reason,
  });
}

console.log(JSON.stringify({
  model: service.defaultModel,
  modelAvailable: status.available,
  // The first model case measures cold startup; later ones measure warm runs.
  results,
}, null, 2));
