import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { RevisionService } = require("../src/main/services/revision-service.cjs");

const service = new RevisionService({ timeoutMs: 30000 });
const models = process.argv.slice(2).filter(Boolean);
if (!models.length) models.push("qwen2.5:3b", "qwen3:4b", "qwen3.5:4b");

const cases = [
  {
    id: "hesitacao",
    input: "Então, preciso enviar o relatório amanhã.",
    expected: "Preciso enviar o relatório amanhã.",
  },
  {
    id: "repeticao",
    input: "Eu, eu preciso revisar o contrato.",
    expected: "Eu preciso revisar o contrato.",
  },
  {
    id: "negacao",
    input: "Não quero falar sobre esse assunto.",
    expected: "Não quero falar sobre esse assunto.",
  },
  {
    id: "objeto",
    input: "Precisamos revisar o contrato e atualizar a proposta.",
    expected: "Precisamos revisar o contrato e atualizar a proposta.",
  },
  {
    id: "horario",
    input: "A reunião ficou para amanhã às 14:30.",
    expected: "A reunião ficou para amanhã às 14:30.",
  },
  {
    id: "muleta_inicial",
    input: "Bom, eu preciso confirmar a entrega hoje.",
    expected: "Eu preciso confirmar a entrega hoje.",
  },
  {
    id: "hesitacao_curta",
    input: "É, vamos revisar o pedido antes de enviar.",
    expected: "Vamos revisar o pedido antes de enviar.",
  },
  {
    id: "repeticao_verbo",
    input: "Preciso, preciso falar com a Marina sobre o contrato.",
    expected: "Preciso falar com a Marina sobre o contrato.",
  },
  {
    id: "pausa_sem_edicao",
    input: "A proposta inclui suporte e treinamento.",
    expected: "A proposta inclui suporte e treinamento.",
  },
  {
    id: "negacao_dupla",
    input: "Não envie o contrato hoje e não altere o prazo.",
    expected: "Não envie o contrato hoje e não altere o prazo.",
  },
  {
    id: "nome_proprio",
    input: "A Juliana vai apresentar o relatório para o Rafael.",
    expected: "A Juliana vai apresentar o relatório para o Rafael.",
  },
  {
    id: "valor_protegido",
    input: "O valor aprovado é R$ 1.250,00.",
    expected: "O valor aprovado é R$ 1.250,00.",
  },
  {
    id: "numero_corrigido",
    input: "O orçamento é 200… não, 300 reais.",
    expected: "O orçamento é 300 reais.",
  },
  {
    id: "horario_corrigido",
    input: "A reunião é às duas… não, às três.",
    expected: "A reunião é às três.",
  },
  {
    id: "lista_explicita",
    input: "Primeiro, comprar pão; segundo, ligar para Ana.",
    expected: "1. Comprar pão\n2. Ligar para Ana.",
  },
  {
    id: "ordem_apagar",
    input: "Envie o relatório. O prazo é sexta. Apague a última frase.",
    expected: "Envie o relatório.",
  },
];

const normalize = (value) => String(value).trim().toLocaleLowerCase("pt-BR")
  .replace(/[.,;:!?]/g, "").replace(/\s+/g, " ");
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
};
const results = [];
for (const model of models) {
  for (const item of cases) {
    const result = await service.revise(item.input, {
      mode: "light",
      model,
      timeoutMs: 30000,
    });
    const row = {
      model,
      case: item.id,
      input: item.input,
      expected: item.expected,
      output: result.text,
      match: normalize(result.text) === normalize(item.expected),
      needsEdit: normalize(item.input) !== normalize(item.expected),
      applied: result.applied,
      fallback: result.fallback,
      reason: result.reason,
      elapsedMs: result.elapsedMs,
    };
    results.push(row);
    process.stdout.write(`${model} ${item.id}: ${row.match ? "ok" : "difere"}, ${row.elapsedMs} ms, ${row.reason || "aplicado"}\n`);
  }
}

const summary = models.map((model) => {
  const rows = results.filter((row) => row.model === model);
  return {
    model,
    matches: rows.filter((row) => row.match).length,
    neededEditsMatched: rows.filter((row) => row.needsEdit && row.match).length,
    neededEdits: rows.filter((row) => row.needsEdit).length,
    cases: rows.length,
    fallbacks: rows.filter((row) => row.fallback).length,
    totalMs: rows.reduce((total, row) => total + row.elapsedMs, 0),
    warmMedianMs: rows.length > 1
      ? median(rows.slice(1).map((row) => row.elapsedMs))
      : null,
  };
});
const report = { measuredAt: new Date().toISOString(), cases: results, summary };
const target = path.join(process.cwd(), "docs", "historico", "outputs", "revision-model-comparison-2026-09.json");
await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ summary, report: target }, null, 2));
