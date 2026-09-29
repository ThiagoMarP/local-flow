# Local Flow — resumo da Fase 6

Fase concluída em 24 de junho de 2026.

## Modos disponíveis

- **Literal:** entrega diretamente o resultado do Whisper.
- **Limpo:** corrige pontuação e problemas evidentes.
- **Inteligente:** reorganiza o ditado para melhorar clareza.

O modo literal continua sendo o padrão. O Ollama é opcional e todo o
processamento permanece local.

## Segurança do fallback

A revisão é descartada quando:

- o Ollama está offline;
- a resposta excede o timeout;
- o modelo retorna conteúdo inválido;
- números, horários, URLs ou e-mails são alterados;
- um objeto explícito do texto desaparece;
- o ditado excede o limite seguro de contexto.

Nesses casos, o texto original do Whisper é mantido integralmente.

## Modelos

- Padrão: `qwen2.5:3b`.
- Alternativa instalada: `qwen2.5:7b`.

## Desempenho observado

- Revisão limpa válida: aproximadamente 1,5 s.
- Revisão inteligente válida: aproximadamente 1,7 s.
- Pipeline real Whisper + Ollama: aproximadamente 3,2 s para uma
  amostra de 6,1 segundos.

## Validação

- 39 testes unitários.
- Ollama simulado e Ollama real.
- Fallback de segurança com modelo real.
- Persistência de modo e modelo.
- Interface online/offline.
- Smoke, ciclo de vida, bandeja, atalho, inserção e microfone.
- Verificadores das fases 1 a 6.

O próximo marco é a Fase 7: dicionário pessoal, snippets, substituições
e perfis de escrita.
