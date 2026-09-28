import assert from "node:assert/strict";
import test from "node:test";
import { capsuleErrorLabel } from "../src/renderer/capsule-labels.js";

// As mensagens abaixo são as que o app realmente publica no estado de erro. A
// cápsula tem ~230 px: cada uma precisa virar uma frase curta que diga o que
// quebrou, deixando o detalhe para o painel.
test("resume os erros de microfone pela causa", () => {
  assert.equal(
    capsuleErrorLabel(
      "Não foi possível acessar o microfone: A permissão foi bloqueada. Abra Configurações do Windows > Privacidade e segurança > Microfone e permita o Local Flow.",
    ),
    "Microfone bloqueado",
  );
  assert.equal(
    capsuleErrorLabel(
      "Não foi possível acessar o microfone: Nenhum microfone foi encontrado pelo Windows.",
    ),
    "Nenhum microfone",
  );
  assert.equal(
    capsuleErrorLabel("Não foi possível acessar o microfone: Could not start audio source"),
    "Microfone indisponível",
  );
});

test("resume as falhas do motor de transcrição", () => {
  assert.equal(
    capsuleErrorLabel(
      'Falha na transcrição: O modelo do perfil "standard" ainda não foi baixado. Abra o Local Flow e baixe o modelo em Configuração antes de ditar.',
    ),
    "Modelo não baixado",
  );
  assert.equal(
    capsuleErrorLabel(
      "Falha na transcrição: O modelo Parakeet ainda não foi baixado. Baixe-o em Configuração antes de ditar.",
    ),
    "Modelo não baixado",
  );
  assert.equal(
    capsuleErrorLabel(
      "Falha na transcrição: O motor de transcrição Parakeet não foi encontrado. Reinstale o Local Flow.",
    ),
    "Motor não encontrado",
  );
  assert.equal(
    capsuleErrorLabel("Falha na transcrição: O Parakeet terminou com código 3221225477."),
    "Motor não carregou",
  );
  assert.equal(
    capsuleErrorLabel("Falha na transcrição: A transcrição excedeu o limite de 120 segundos."),
    "Transcrição demorou demais",
  );
  assert.equal(
    capsuleErrorLabel("Falha na transcrição: O Whisper não reconheceu fala no áudio."),
    "Nenhuma fala reconhecida",
  );
  assert.equal(
    capsuleErrorLabel("Falha na transcrição: algo inesperado"),
    "Falha na transcrição",
  );
});

test("resume os demais erros conhecidos", () => {
  assert.equal(capsuleErrorLabel("Nenhum áudio foi capturado."), "Nenhum áudio captado");
  assert.equal(
    capsuleErrorLabel("O atalho não pôde iniciar o ditado."),
    "Atalho não iniciou",
  );
  assert.equal(capsuleErrorLabel("Falha ao iniciar: boom"), "Falha ao iniciar");
  assert.equal(
    capsuleErrorLabel("Falha na transcrição da reunião"),
    "Reunião não transcrita",
  );
});

test("mensagem curta desconhecida passa inteira; longa vira genérica", () => {
  assert.equal(capsuleErrorLabel("Nada para colar"), "Nada para colar");
  assert.equal(
    capsuleErrorLabel("Uma mensagem desconhecida e comprida demais para caber"),
    "Algo deu errado",
  );
  assert.equal(capsuleErrorLabel(""), "Algo deu errado");
  assert.equal(capsuleErrorLabel(undefined), "Algo deu errado");
});
