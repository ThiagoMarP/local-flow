# Modelos locais para revisão de ditado — 25/09/2026

## Resposta curta

**Mantenha `qwen2.5:3b` por enquanto.** Comparei `qwen3:4b` e o candidato recente `qwen3.5:4b` nesta máquina. Em 16 frases sintéticas, ambos acertaram 13/16 contra 12/16 do modelo atual, mas foram mais lentos e fizeram algumas edições indesejadas. Esse resultado não justifica trocar o padrão. [Qwen3 4B](https://huggingface.co/Qwen/Qwen3-4B) · [Qwen3.5 4B](https://huggingface.co/Qwen/Qwen3.5-4B) · [Ollama Qwen3](https://ollama.com/library/qwen3) · [Ollama Qwen3.5](https://ollama.com/library/qwen3.5)

## Contexto verificado no projeto

- `revision-service.cjs` usa `qwen2.5:3b` por padrão. Para o modo Limpeza leve, faz primeiro um tratamento determinístico e, quando necessário, chama `/api/generate` do Ollama com `format: "json"`, contexto 4096, temperatura 0,1 e limite de 15 s. Durante esta tarefa, a requisição foi ajustada pelo agente de implementação para `think: false`.
- `ollama list` nesta máquina mostrou `qwen2.5:3b` (1,9 GB), `qwen2.5:7b` (4,7 GB) e `qwen3:4b` (2,5 GB); `qwen3.5:4b` (3,4 GB) foi baixado nesta tarefa. O processador e a memória informados para a pesquisa são Ryzen AI 9 HX 370, Radeon 890M integrada e 32 GB RAM no Windows.
- A medição anterior com `qwen2.5:3b` foi de 7,6 s na primeira revisão e 2,8–3,6 s nas seguintes, em três exemplos. É uma referência pequena, sem comparação paralela entre modelos nem amostra de ditados reais. [Plano de avaliação do projeto](LIMPEZA-LEVE.md)

## Candidatos

| Modelo | Estado e tamanho no Ollama | Evidência oficial pertinente | Licença | Julgamento para este uso |
|---|---|---|---|---|
| `qwen2.5:3b` | Instalado, 1,9 GB | A Qwen declara português entre mais de 29 idiomas e capacidade de seguir instruções e produzir JSON. | `qwen-research` na [ficha oficial](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct) | Referência atual; manter para comparação. Conferir termos se houver redistribuição. |
| `qwen2.5:7b` | Instalado, 4,7 GB | A [ficha Qwen](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) declara português entre mais de 29 idiomas e capacidade de seguir instruções e produzir JSON. | Apache-2.0 | Controle de qualidade para um modelo maior já disponível; a espera pode ser maior e precisa de medição. |
| `qwen3:4b` | Instalado, 2,5 GB no [Ollama](https://ollama.com/library/qwen3) | A [ficha Qwen](https://huggingface.co/Qwen/Qwen3-4B) declara mais de 100 idiomas/dialetos, melhorias gerais de seguimento de instruções e opção de desativar raciocínio para respostas mais diretas. | Apache-2.0 | **Primeiro teste**, pois não exige baixar outro modelo. Pode ser melhor, mas qualidade e latência precisam ser medidas. |
| `qwen3.5:4b` | Baixado nesta tarefa; 3,4 GB no [Ollama](https://ollama.com/library/qwen3.5) | A [ficha Qwen](https://huggingface.co/Qwen/Qwen3.5-4B) declara 201 idiomas/dialetos e modelo multimodal. Publica benchmarks gerais, sem teste isolado de limpeza de ditado pt-BR. Raciocina por padrão; a ficha descreve modo sem raciocínio via parâmetros de API. | Apache-2.0 | Testado localmente; não houve ganho claro que compensasse a espera maior. |
| `gemma3:4b` | Não instalado; 3,3 GB no [Ollama](https://ollama.com/library/gemma3) | O Google/Ollama declaram mais de 140 idiomas e tarefas de resumo, perguntas e raciocínio. | [Termos Gemma](https://ai.google.dev/gemma/terms), distintos de Apache-2.0 | Alternativa posterior. Sem sinal oficial específico de melhor edição mínima em pt-BR. |

Os tamanhos acima são dos artefatos listados/instalados no Ollama, **não** memória de execução. A ficha do Qwen2.5-3B-Instruct identifica licença `qwen-research`; para qualquer distribuição, verificar a licença do artefato exato instalado. Os benchmarks dos fabricantes medem outras tarefas e infraestrutura. Não se deve inferir deles um ganho de tempo no notebook.

## Hardware e integração

A [lista oficial de GPU do Ollama](https://docs.ollama.com/gpu#amd-radeon) inclui Ryzen AI 9 HX 370 em Linux, mas a lista ROCm para **Windows** não inclui a Radeon 890M. A mesma documentação diz que Vulkan amplia o suporte em Windows; isso não confirma que a sessão atual está acelerada pela GPU. Antes de atribuir velocidade ao modelo, registrar runtime real (CPU/Vulkan), RAM e tempo de carga. Não alterar drivers ou backend só para este primeiro teste.

A [API de raciocínio do Ollama](https://docs.ollama.com/capabilities/thinking) aceita `think: false` em `/api/generate` quando o modelo permite e recomenda verificar as opções de cada modelo com `/api/show`. É especialmente relevante para Qwen3 e Qwen3.5, pois a tarefa pede uma única edição curta. Primeiro conferir `/api/show` da instalação local e a resposta com o campo desligado; depois medir. O Qwen3.5 não usa oficialmente o atalho textual `/no_think` do Qwen3, conforme sua ficha. `format: "json"` sozinho não garante fidelidade de conteúdo: a validação da Limpeza leve continua necessária.

**Observação local desta tarefa:** numa chamada ao `qwen3:4b` antes desse ajuste, o campo `response` veio vazio e o JSON apareceu no campo `thinking`; com `think: false`, o JSON apareceu em `response`. Isso foi observado neste Ollama e explica por que apenas selecionar o Qwen3 com o código anterior poderia causar fallback. É um teste de integração, não uma medição de qualidade ou latência.

## Comparação local (sintética)

Usei 16 frases por modelo, incluindo hesitações, repetições, negações, nomes, valores e quatro correções explícitas resolvidas pelo caminho rápido. Os [resultados de 3B, Qwen3 e Qwen3.5](../outputs/revision-model-comparison-2026-09-3b-4b-35.json) e os [resultados de 7B](../outputs/revision-model-comparison-2026-09-7b.json) preservam todas as entradas, saídas e durações. A correspondência é com o texto esperado nesses casos, **não** uma nota geral de qualidade. Usei `think: false` e excluí a primeira chamada de cada sequência ao calcular a mediana; a ordem e o cache do Ollama ainda influenciam os tempos.

| Modelo | Correspondências | Edições necessárias acertadas | Fallbacks | Mediana após a primeira |
|---|---:|---:|---:|---:|
| `qwen2.5:3b` | 12/16 | 5/9 | 1 | 1,08 s |
| `qwen2.5:7b` | 13/16 | 6/9 | 0 | 1,81 s |
| `qwen3:4b` | 13/16 | 6/9 | 2 | 1,38 s |
| `qwen3.5:4b` | 13/16 | 6/9 | 1 | 2,84 s |

Todos acertaram as quatro correções rápidas, que dispensam o modelo. Qwen3.5 transformou uma hesitação inicial em citação e alterou “entrega hoje” para “entrega de hoje”; o validador aceitou essas edições. Qwen3 removeu “eu” em uma frase e preservou “É” em outra. Nenhum modelo removeu “Então” do primeiro caso. A amostra é pequena e sintética: não estabelece superioridade nem justifica troca do padrão. Não medi o tempo completo de transcrição e colagem.

## Comparação real que decide a troca

1. Usar os mesmos pelo menos 40 ditados reais em pt-BR previstos no [plano](LIMPEZA-LEVE.md), com gabarito humano e casos de números corrigidos, nomes, links, listas, negações, correções ambíguas e frases que não devem ser apagadas.
2. Comparar os quatro modelos instalados com o mesmo prompt, validador e textos; isolar execução fria e aquecida, taxa de JSON válido, revisões aceitas, fallbacks, falsos positivos e segundos até inserção. Incluir o caminho rápido separado da chamada ao modelo.
3. Só considerar uma troca se o candidato melhorar correções sem piora perceptível de espera ou perda de fatos nos ditados reais. Preservar escolha do usuário e Literal como padrão; não trocar o modelo apenas com base nas fichas ou nas frases acima.

**Limite desta pesquisa:** as páginas oficiais acima foram consultadas em 25/09/2026. O Qwen3.5 foi baixado e testado localmente. Não foi medida a qualidade em ditados reais do usuário.
