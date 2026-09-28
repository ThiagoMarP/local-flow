const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RevisionService,
  normalizeEndpoint,
  validateCandidate,
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

test("limpeza leve corrige horário explícito sem chamar o Ollama", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("A reunião é às duas… não, às três.", {
    mode: "light",
  });
  assert.equal(result.text, "A reunião é às três.");
  assert.equal(result.applied, true);
  assert.equal(result.fallback, false);
  assert.equal(result.reason, "fast-correction");
});

test("limpeza rápida remove repetição evidente sem consultar o Ollama", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("Eu, eu preciso revisar o contrato.", {
    mode: "fast",
  });
  assert.equal(result.text, "Eu preciso revisar o contrato.");
  assert.equal(result.reason, "fast-repetition");
  assert.equal(result.path, "fast");
});

test("limpeza rápida preserva afirmações e não consulta o Ollama", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("Não quero falar sobre esse assunto.", {
    mode: "fast",
  });
  assert.equal(result.text, "Não quero falar sobre esse assunto.");
  assert.equal(result.applied, false);
  assert.equal(result.fallback, false);
  assert.equal(result.path, "fast");
});

test("limpeza rápida mantém números e negações repetidas sem sinal de correção", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("Não, não altere o prazo de 14:30.", {
    mode: "fast",
  });
  assert.equal(result.text, "Não, não altere o prazo de 14:30.");
  assert.equal(result.applied, false);
});

test("contraste de horários não vira uma correção", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "A reunião é às três." }),
    }),
  });
  const original = "A reunião é às duas, não às três.";
  const result = await service.revise(original, { mode: "light" });
  assert.equal(result.text, original);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "negation-changed");
});

test("limpeza leve aceita substituição explícita de número", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("O orçamento é 200… não, 300 reais.", {
    mode: "light",
  });
  assert.equal(result.text, "O orçamento é 300 reais.");
  assert.equal(result.path, "fast");
});

test("limpeza leve corrige um objeto explícito com quer dizer", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("Vamos revisar o contrato, quer dizer, a proposta.", {
    mode: "light",
  });
  assert.equal(result.text, "Vamos revisar a proposta.");
  assert.equal(result.path, "fast");
});

test("limpeza leve formata enumeração explícita sem chamar o Ollama", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("Primeiro, comprar pão; segundo, ligar para Ana.", {
    mode: "light",
  });
  assert.equal(result.text, "1. Comprar pão\n2. Ligar para Ana.");
  assert.equal(result.reason, "fast-list");
});

test("limpeza leve mantém frase sem separadores claros de lista", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "Primeiro, eu conto e segundo, você conta." }),
    }),
  });
  const original = "Primeiro, eu conto e segundo, você conta.";
  const result = await service.revise(original, { mode: "light" });
  assert.equal(result.text, original);
  assert.equal(result.path, "model");
});

test("limpeza leve mantém negação afirmativa se o modelo a apagar", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "Quero falar sobre esse assunto." }),
    }),
  });
  const result = await service.revise("Não quero falar sobre esse assunto.", {
    mode: "light",
  });
  assert.equal(result.text, "Não quero falar sobre esse assunto.");
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "negation-changed");
});

test("limpeza leve protege negação sem acento da transcrição", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "Quero falar sobre esse assunto." }),
    }),
  });
  const result = await service.revise("Nao quero falar sobre esse assunto.", {
    mode: "light",
  });
  assert.equal(result.text, "Nao quero falar sobre esse assunto.");
  assert.equal(result.reason, "negation-changed");
});

test("limpeza leve preserva a ação, mesmo quando a negação permanece", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "Não posso falar sobre esse assunto." }),
    }),
  });
  const result = await service.revise("Não quero falar sobre esse assunto.", {
    mode: "light",
  });
  assert.equal(result.text, "Não quero falar sobre esse assunto.");
  assert.equal(result.reason, "content-word-changed");
});

test("limpeza leve rejeita informação nova inserida pelo modelo", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "Enviar o relatório amanhã." }),
    }),
  });
  const result = await service.revise("Enviar o relatório.", { mode: "light" });
  assert.equal(result.text, "Enviar o relatório.");
  assert.equal(result.reason, "content-word-added");
});

test("limpeza leve rejeita lista JSON colada antes do ditado", async () => {
  const original = "As imagens devem aparecer na ordem: a 1, depois a 2 e por fim a 3.";
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: `["1","2","3"][${original}]` }),
    }),
  });
  const result = await service.revise(original, { mode: "light" });
  assert.equal(result.text, original);
  assert.equal(result.reason, "structured-output-added");
});

test("limpeza leve aceita pontuação e remoção de hesitação", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "Preciso enviar o relatório amanhã." }),
    }),
  });
  const result = await service.revise("Então, preciso enviar o relatório amanhã", {
    mode: "light",
  });
  assert.equal(result.text, "Preciso enviar o relatório amanhã.");
  assert.equal(result.fallback, false);
});

test("limpeza leve mantém o original se o modelo alterar número sem correção", async () => {
  const service = new RevisionService({
    fetchImpl: async () => response({
      response: JSON.stringify({ text: "A reunião ficou para 15:30." }),
    }),
  });
  const result = await service.revise("A reunião ficou para 14:30.", {
    mode: "light",
  });
  assert.equal(result.text, "A reunião ficou para 14:30.");
  assert.equal(result.reason, "protected-token-changed");
});

test("limpeza leve aplica correção com quer dizer sem o modelo", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("O prazo é amanhã, quer dizer, sexta.", {
    mode: "light",
  });
  assert.equal(result.text, "O prazo é sexta.");
  assert.equal(result.path, "fast");
  assert.equal(result.fallback, false);
});

test("limpeza leve executa comando de edição explícito", async () => {
  const service = new RevisionService({
    fetchImpl: async () => { throw new Error("não deveria chamar"); },
  });
  const result = await service.revise("Envie o relatório. O prazo é sexta. Apague a última frase.", {
    mode: "light",
  });
  assert.equal(result.text, "Envie o relatório.");
  assert.equal(result.reason, "fast-command");
});

test("Esc durante revisão interrompe Ollama sem cair no fallback", async () => {
  const controller = new AbortController();
  const service = new RevisionService({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new DOMException("Cancelado", "AbortError"));
      }, { once: true });
    }),
  });
  const running = service.revise("Texto original.", {
    mode: "clean",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(running, { name: "AbortError", code: "ABORT_ERR" });
});

test("modo limpo aceita JSON válido do modelo", async () => {
  const service = new RevisionService({
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "qwen2.5:3b");
      assert.equal(payload.stream, false);
      assert.equal(payload.think, false);
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

test("prompt mode produces a concise request", async () => {
  const service = new RevisionService({
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.match(payload.system, /pedidos curtos e claros/i);
      assert.match(payload.system, /remova cumprimentos, despedidas/i);
      assert.doesNotMatch(payload.system, /# Mudança solicitada/i);
      assert.match(payload.prompt, /pedido curto e direto/i);
      return response({
        response: JSON.stringify({
          text: "Crie uma tela de login com autenticação por e-mail usando Electron e TypeScript.",
        }),
      });
    },
  });
  const result = await service.revise(
    "quero criar uma tela de login com autenticacao por e-mail usando Electron e TypeScript",
    { mode: "prompt" },
  );
  assert.equal(result.fallback, false);
  assert.equal(
    result.text,
    "Crie uma tela de login com autenticação por e-mail usando Electron e TypeScript.",
  );
});

test("prompt mode rejects internal instruction echo", async () => {
  const service = new RevisionService({
    fetchImpl: async () =>
      response({
        response: JSON.stringify({
          text: "Você reescreve transcrições faladas como pedidos curtos.",
        }),
      }),
  });
  const result = await service.revise("crie uma tela de login", {
    mode: "prompt",
  });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "prompt-echoed");
});

test("prompt mode accepts plain text when a local model skips the JSON wrapper", async () => {
  const service = new RevisionService({
    fetchImpl: async () =>
      response({
        response: "Organize o pedido de melhoria para a IA.",
      }),
  });
  const result = await service.revise(
    "quero organizar um pedido de melhoria para a minha IA",
    { mode: "prompt" },
  );
  assert.equal(result.fallback, false);
  assert.equal(result.text, "Organize o pedido de melhoria para a IA.");
});

test("prompt mode does not call the local model for empty input", async () => {
  let calls = 0;
  const service = new RevisionService({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("não deveria chamar");
    },
  });
  const result = await service.revise("   ", { mode: "prompt" });
  assert.equal(calls, 0);
  assert.equal(result.text, "");
  assert.equal(result.reason, "empty-input");
});

test("endpoint remoto é rejeitado", () => {
  assert.throws(
    () => normalizeEndpoint("https://example.com"),
    /deve ser local/,
  );
});

// O modelo às vezes devolve a própria instrução dentro do JSON; isso já vazou
// para um ditado real ("Revise o ditado delimitado abaixo." no meio do texto).
test("descarta revisão que ecoou o prompt", () => {
  assert.equal(
    validateCandidate(
      "preciso revisar o contrato hoje",
      "Revise o ditado delimitado abaixo. Preciso revisar o contrato hoje.",
      "clean",
    ),
    "prompt-echoed",
  );
  assert.equal(
    validateCandidate(
      "preciso revisar o contrato hoje",
      "Preciso revisar o contrato hoje.",
      "clean",
    ),
    null,
  );
});
