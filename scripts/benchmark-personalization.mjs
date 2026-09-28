import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const {
  PersonalizationService,
} = require("../src/main/services/personalization-service.cjs");

const service = new PersonalizationService();
const replacements = Array.from({ length: 100 }, (_, index) => ({
  from: `termo ${index}`,
  to: `valor ${index}`,
}));
const snippets = Array.from({ length: 50 }, (_, index) => ({
  trigger: `snippet ${index}.`,
  expansion: `Conteúdo completo do snippet ${index}.`,
}));
const input =
  "Este texto contém termo 99 e termina solicitando snippet 49.";
const iterations = 2000;

for (let index = 0; index < 50; index += 1) {
  const replaced = service.applyReplacements(input, replacements);
  service.expandSnippets(replaced.text, snippets);
}

const startedAt = performance.now();
let output;
for (let index = 0; index < iterations; index += 1) {
  const replaced = service.applyReplacements(input, replacements);
  output = service.expandSnippets(replaced.text, snippets);
}
const elapsedMs = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      iterations,
      rulesPerIteration: replacements.length + snippets.length,
      averageMs: Number((elapsedMs / iterations).toFixed(4)),
      totalMs: Number(elapsedMs.toFixed(1)),
      output: output.text,
    },
    null,
    2,
  ),
);
