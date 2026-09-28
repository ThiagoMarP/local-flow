# Fase 7 — Personalização

## Estado

Concluída em 2026-06-24.

## Objetivo

Adaptar o Local Flow ao vocabulário e aos padrões de escrita do usuário
sem tornar o resultado dependente de um modelo remoto ou de regras
opacas.

## Recursos

### Dicionário pessoal

- Mantém termos técnicos e nomes como contexto do Whisper.
- Limite e deduplicação continuam validados pelo schema.

### Substituições

- Regras literais no formato `origem => destino`.
- Comparação sem diferenciar maiúsculas e minúsculas.
- Frases maiores têm prioridade.
- Uma substituição não dispara outra regra em cascata.
- Aplicadas antes da revisão para corrigir erros recorrentes.

### Snippets

- Frases-gatilho no formato `gatilho => conteúdo`.
- Suporte a `\n` para quebras de linha.
- Expansão depois da revisão por LLM.
- O conteúdo expandido nunca é enviado ao Ollama.
- Uma expansão não dispara outro snippet em cascata.

### Perfis de escrita

- Neutro.
- Conciso.
- Profissional.
- Casual.

Os perfis orientam apenas os modos limpo e inteligente. No modo
literal, substituições e snippets continuam funcionando normalmente.

## Ordem do pipeline

```text
Whisper
  → substituições pessoais
  → revisão opcional pelo Ollama
  → snippets exatos
  → clipboard/inserção
```

## Regras de segurança

- Regras vazias ou excessivamente longas são descartadas.
- Limites impedem arquivos de configuração descontrolados.
- O conteúdo das regras não entra em logs.
- Logs registram apenas contagens de regras aplicadas.
- Falha de personalização mantém o texto disponível.
- Snippets não podem ser modificados pelo LLM.

## Critérios de saída

- Dicionário continua alimentando o prompt do Whisper.
- Substituições são persistentes e não produzem cascata.
- Snippets são persistentes, exatos e suportam múltiplas linhas.
- Perfis de escrita são persistentes e enviados ao Ollama.
- Interface permite editar todos os recursos.
- Resultado informa quantas personalizações foram aplicadas.
- Teste Electron aplica uma substituição e um snippet.
- Todos os testes e verificadores anteriores continuam aprovados.

## Entrega realizada

- Dicionário pessoal continua integrado ao prompt inicial do Whisper.
- Substituições literais com prioridade para frases maiores.
- Marcadores internos impedem regras em cascata.
- Substituições vazias removem vícios de linguagem e normalizam espaços.
- Snippets exatos com suporte a múltiplas linhas.
- Snippets são expandidos somente depois da revisão pelo Ollama.
- Perfis neutro, conciso, profissional e casual.
- Editor local de regras com persistência automática.
- Migração automática do schema de configurações para a versão 3.
- Logs redigem substituições, gatilhos e expansões.
- Resultado informa quantas regras foram aplicadas.

## Desempenho

Benchmark com o limite completo de 100 substituições e 50 snippets:

- 2.000 execuções.
- Média de 0,18 ms por execução.
- 150 regras avaliadas em cada execução.

O custo determinístico é desprezível em comparação com Whisper e
Ollama.

## Validação final

- 46 testes unitários aprovados.
- Persistência de perfil, substituições e snippets aprovada.
- Teste Electron aplicou uma substituição e um snippet multilinha.
- Teste Ollama simulado confirmou o perfil profissional no prompt.
- Pipeline real Whisper e fallback real do Ollama aprovados.
- Smoke, bandeja, ciclo de vida, atalho e instância única aprovados.
- Inserção automática e restauração do clipboard aprovadas.
- Captura real do microfone aprovada.
- Verificadores das fases 1 a 7 aprovados.
