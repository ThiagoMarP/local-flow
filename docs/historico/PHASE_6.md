# Fase 6 — Revisão inteligente local

## Estado

Concluída em 2026-06-24.

## Objetivo

Adicionar uma etapa opcional de revisão após o Whisper usando o Ollama
local, sem comprometer a privacidade nem transformar o LLM em uma
dependência obrigatória da transcrição.

## Modos

### Literal

- Entrega exatamente o texto produzido pelo Whisper.
- Não inicia nem consulta o Ollama.
- Continua sendo o modo padrão.

### Limpo

- Corrige pontuação, capitalização e concordância evidente.
- Remove hesitações e repetições apenas quando forem inequívocas.
- Preserva intenção, nomes, números, links e fatos.

### Inteligente

- Reorganiza o ditado para melhorar clareza e fluidez.
- Pode transformar fragmentos em frases naturais.
- Não pode adicionar fatos, decisões ou informações ausentes.

## Arquitetura

```text
microfone
  → Whisper
  → TranscriptionPipeline
      ├─ literal: texto original
      └─ limpo/inteligente: RevisionService → Ollama local
                                   └─ falha: texto original
  → clipboard/inserção
```

## Regras de segurança

- O endpoint deve ser local (`127.0.0.1`, `localhost` ou `::1`).
- O texto não entra em logs.
- Timeout limitado e cancelamento por `AbortController`.
- Respostas vazias, excessivamente longas ou que alterem números
  protegidos são rejeitadas.
- A falha da revisão nunca transforma uma transcrição válida em erro.
- A interface informa quando o texto original foi mantido.

## Configurações

- Modo de revisão.
- Modelo Ollama.
- Timeout interno validado.
- Estado de disponibilidade e modelos locais detectados.

## Critérios de saída

- Modos literal, limpo e inteligente disponíveis.
- Literal não realiza chamada HTTP.
- `qwen2.5:3b` é o padrão e `qwen2.5:7b` pode ser selecionado.
- Ollama offline mantém o texto original.
- Timeout mantém o texto original.
- Resposta inválida mantém o texto original.
- Números, e-mails e URLs protegidos não podem desaparecer.
- Inserção e clipboard usam o texto final revisado.
- Logs contêm somente metadados da revisão.
- Teste com servidor Ollama simulado aprovado.
- Teste com o modelo local real registrado.
- Todas as fases anteriores continuam aprovadas.

## Entrega realizada

- Serviço Ollama limitado a endpoints de loopback.
- Pipeline único para Whisper, revisão e fallback.
- Modos literal, limpo e inteligente persistidos nas configurações.
- Seleção entre os modelos Ollama instalados.
- Detecção visual de Ollama online e offline.
- Progresso “Revisando com o Ollama local…” durante o processamento.
- Metadados de revisão na interface, sem registrar o conteúdo.
- Proteção para números, horários, URLs, e-mails e objetos explícitos.
- Ditados acima do limite de contexto mantêm o texto completo e não
  são enviados ao modelo.
- Testes headless separados dos testes de janela para eliminar
  interferência do subprocesso GPU.

## Medições com `qwen2.5:3b`

- Detecção do Ollama e dos dois modelos: 28–51 ms.
- Modo limpo, revisão válida: 1,5 s.
- Modo inteligente, revisão válida: 1,7 s.
- Pipeline real Whisper + Ollama: aproximadamente 3,2 s na amostra
  de 6,1 segundos.
- Em uma revisão ambígua, a proteção detectou a remoção de “proposta”
  e manteve o texto original.

## Validação final

- 39 testes unitários aprovados.
- Teste Electron com Ollama simulado aplicou a revisão.
- Teste Electron com Ollama real validou o fallback sem perda.
- Benchmark real validou os modos limpo e inteligente.
- Persistência do modo e do modelo aprovada.
- Smoke, bandeja, ciclo de vida, atalho e instância única aprovados.
- Inserção automática e restauração do clipboard aprovadas.
- Captura real do microfone aprovada.
- Verificadores das fases 1 a 6 aprovados.
