const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RevisionService,
  normalizeEndpoint,
} = require("../src/main/services/revision-service.cjs");

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

test("modo literal não consulta o Ollama", async () => {
  let calls = 0;
  const service = new RevisionService({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("não deveria chamar");
    },
  });
  const result = await service.revise("Texto original.", {
    mode: "literal",
  });
  assert.equal(calls, 0);
  assert.equal(result.text, "Texto original.");
  assert.equal(result.applied, false);
  assert.equal(result.fallback, false);
});

test("modo limpo aceita JSON válido do modelo", async () => {
  const service = new RevisionService({
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "qwen2.5:3b");
      assert.equal(payload.stream, false);
      return response({
        response: JSON.stringify({
          text: "Vamos revisar o contrato amanhã às 14:30.",
        }),
      });
    },
  });
  const result = await service.revise(
    "vamos revisar o contrato amanhã às 14:30",
    { mode: "clean" },
  );
  assert.equal(
    result.text,
    "Vamos revisar o contrato amanhã às 14:30.",
  );
  assert.equal(result.applied, true);
  assert.equal(result.fallback, false);
});

test("alteração de número protegido usa fallback", async () => {
  const service = new RevisionService({
    fetchImpl: async () =>
      response({
        response: JSON.stringify({
          text: "A reunião ficou para 15:30.",
        }),
      }),
  });
  const result = await service.revise(
    "A reunião ficou para 14:30.",
    { mode: "smart" },
  );
  assert.equal(result.text, "A reunião ficou para 14:30.");
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "protected-token-changed");
});

test("sufixo adicionado a horário protegido usa fallback", async () => {
  const service = new RevisionService({
    fetchImpl: async () =>
      response({
        response: JSON.stringify({
          text: "A reunião ficou para 14:30h.",
        }),
      }),
  });
  const result = await service.revise(
    "A reunião ficou para 14:30.",
    { mode: "clean" },
  );
  assert.equal(result.text, "A reunião ficou para 14:30.");
  assert.equal(result.reason, "protected-token-changed");
});

test("remoção de objeto explícito usa fallback", async () => {
  const service = new RevisionService({
    fetchImpl: async () =>
      response({
        response: JSON.stringify({
          text: "Vamos revisar o contrato e atualizá-lo.",
        }),
      }),
  });
  const result = await service.revise(
    "Vamos revisar o contrato e atualizar a proposta.",
    { mode: "smart" },
  );
  assert.equal(
    result.text,
    "Vamos revisar o contrato e atualizar a proposta.",
  );
  assert.equal(result.reason, "content-term-changed");
});

test("Ollama indisponível mantém o original", async () => {
  const service = new RevisionService({
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const result = await service.revise("Texto original.", {
    mode: "clean",
  });
  assert.equal(result.text, "Texto original.");
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "ollama-unavailable");
});

test("texto longo demais não é truncado no fallback", async () => {
  const original = `Início ${"conteúdo ".repeat(1600)}fim`;
  const service = new RevisionService({
    fetchImpl: async () => {
      throw new Error("não deveria chamar");
    },
  });
  const result = await service.revise(original, { mode: "smart" });
  assert.equal(result.text, original);
  assert.equal(result.reason, "input-too-long");
});

test("inspeção lista modelos locais", async () => {
  const service = new RevisionService({
    fetchImpl: async () =>
      response({
        models: [
          { name: "qwen2.5:7b" },
          { model: "qwen2.5:3b" },
        ],
      }),
  });
  const status = await service.inspect();
  assert.equal(status.available, true);
  assert.deepEqual(status.models, ["qwen2.5:3b", "qwen2.5:7b"]);
});

test("endpoint remoto é rejeitado", () => {
  assert.throws(
    () => normalizeEndpoint("https://example.com"),
    /deve ser local/,
  );
});
