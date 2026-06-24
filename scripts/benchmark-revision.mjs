import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RevisionService,
} = require("../src/main/services/revision-service.cjs");

const service = new RevisionService({
  endpoint:
    process.env.LOCAL_FLOW_REVISION_ENDPOINT ||
    "http://127.0.0.1:11434",
  defaultModel: process.argv[2] || "qwen2.5:3b",
  timeoutMs: 30000,
});
const cases = [
  {
    mode: "clean",
    text: "então precisamos revisar o contrato antes da reunião e depois enviar a proposta para a equipe",
  },
  {
    mode: "clean",
    text: "então a reunião ficou para amanhã às 14:30 e precisamos revisar o contrato antes",
  },
  {
    mode: "smart",
    text: "manda uma mensagem para a equipe fala que o prazo continua sexta e depois organiza uma reunião para revisar o projeto",
  },
];

const status = await service.inspect({ timeoutMs: 3000 });
if (!status.available) {
  throw new Error(`Ollama indisponível: ${status.reason}`);
}

const results = [];
for (const item of cases) {
  const result = await service.revise(item.text, {
    mode: item.mode,
    model: service.defaultModel,
    timeoutMs: 30000,
  });
  results.push({
    mode: item.mode,
    input: item.text,
    output: result.text,
    applied: result.applied,
    fallback: result.fallback,
    reason: result.reason,
    elapsedMs: result.elapsedMs,
  });
}

console.log(
  JSON.stringify(
    {
      model: service.defaultModel,
      status,
      results,
    },
    null,
    2,
  ),
);
