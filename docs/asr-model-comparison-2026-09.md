# Comparação de modelos ASR locais — 24/09/2026

Atualização em 25/09/2026: o Parakeet TDT 0.6B v3 foi integrado e medido no
Local Flow com as dez amostras do projeto.

## Ponto de partida do Local Flow

O perfil rápido atual é `whisper.cpp` 1.9.1 com `ggml-small-q5_1.bin` (190.085.487 bytes, cerca de 190 MB), executado em CPU com 12 threads no AMD Ryzen AI 9 HX 370. O benchmark local de 10 amostras marcou WER bruto de 38,9% e 2,03 s por amostra. O próprio relatório alerta que esse WER conta diferenças de formatação e não é diretamente comparável aos benchmarks públicos normalizados ([PHASE_1.md](../PHASE_1.md), [environment.json](../benchmarks/environment.json)).

## Números públicos em português

WER menor é melhor. Os números abaixo vêm de conjuntos e normalizações diferentes; servem para escolher candidatos, não para substituir um teste com os mesmos dez áudios do projeto.

| Modelo/runtime | Dataset em português | WER publicado | Tamanho local conhecido | Observação |
|---|---|---:|---:|---|
| Whisper Small (referência independente) | Common Voice + MLS | 15,6% / 13,0% (média 14,3%) | 462 MB sem quantização; o `small-q5_1` local tem 190 MB | Benchmark Picovoice; não é exatamente o binário quantizado do projeto ([tabela](https://github.com/Picovoice/speech-to-text-benchmark/blob/master/README.md#portuguese)) |
| Parakeet TDT 0.6B v3 | FLEURS / MLS / CoVoST `pt` | **4,76% / 7,50% / 3,96%** | **714 MB** no GGUF Q8 oficial | NVIDIA diz que o treino usa português europeu, enquanto muitos testes usam português brasileiro ([card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [arquivo Q8](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/tree/main)) |
| Qwen3-ASR 0.6B | MLS / Common Voice / MLC-SLM / FLEURS `pt` | **12,16% / 11,30% / 34,97% / 6,21%** | **805 MB** no GGUF Q8 oficial; BF16 1,51 GB | O relatório Qwen publica os resultados por idioma; MLC-SLM é um caso difícil ([relatório, tabela A.2](https://arxiv.org/html/2601.21337v2#S4.A2)) |
| Nemotron 3.5 ASR Streaming 0.6B | FLEURS `pt-BR, pt-PT` combinados | **5,48%** com idioma informado; **5,47%** com detecção automática (janela de 1,12 s) | **742 MB** no GGUF Q8 oficial | Lançado em 04/06/2026; é streaming e explicita `pt-BR`/`pt-PT` como locais prontos ([card, desempenho](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), [arquivo Q8](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/tree/main)) |

Como verificação externa, um benchmark independente que calcula a média de FLEURS, MLS e Common Voice 23 colocou o Parakeet v3 em **5,41%** em português e o Whisper large-v3-turbo em **5,97%**; ele não avaliou o Whisper Small nem o Qwen3-ASR ([metodologia e tabela](https://github.com/TheStageAI/TheWhisper/blob/main/benchmark/README.md#multilingual-results)).

O relatório técnico do Qwen também compara médias multilíngues contra `whisper-large-v3`: no conjunto FLEURS de 12 idiomas, Qwen3-ASR 0.6B marcou 7,57% e Whisper large-v3 5,27%; no MLS, 13,19% contra 8,62%. Isso é uma média de idiomas, não uma medição isolada de português ([Qwen3-ASR, tabela 5](https://arxiv.org/html/2601.21337v2#S4.3)).

## O que é realmente comparável

No teste local com os mesmos dez arquivos WAV e a mesma função de WER bruto,
o Parakeet v3 Q8 obteve **19,6% e 1,23 s por amostra**, contra **38,9% e
2,03 s** do Whisper Small Q5 registrado na fase 1. O Whisper usou 12 threads;
o runtime Parakeet usou o paralelismo padrão do executável. As transcrições e
tempos por amostra estão em [parakeet-v3-q8-report.json](../outputs/parakeet-v3-q8-report.json)
e podem ser reproduzidos com `node scripts/benchmark-parakeet.mjs`. O WER
penaliza grafias numéricas diferentes mesmo quando o significado está certo;
"Ollama" também saiu como "OLAM" em uma amostra técnica. Consumo de RAM e
colagem automática não foram medidos nessa comparação.

- O WER local de 38,9% é bruto, em áudio e frases do usuário. Os números de FLEURS/MLS/Common Voice normalmente removem caixa e pontuação e aplicam normalização de números. Não é correto afirmar que qualquer modelo terá 4–12% no áudio do Local Flow.
- A tabela da NVIDIA para Parakeet usa `pt` e avisa que seu treino é predominantemente europeu; isso pode alterar o resultado em fala brasileira. Nemotron publica a linha combinada `pt-BR, pt-PT`, mais próxima do uso pretendido, mas ainda é FLEURS, não o microfone do usuário.
- Os números de velocidade divulgados pelos fabricantes são em GPUs NVIDIA e/ou lotes/concorrência. Não são uma previsão para o Ryzen sem benchmark local. O Qwen, por exemplo, publica RTF 0,00923 (concorrência 1) em vLLM BF16, mas isso é infraestrutura CUDA e áudio de aproximadamente dois minutos, não CPU Windows ([relatório Qwen, tabela 2](https://arxiv.org/html/2601.21337v2#S2.4)).
- Parakeet v3 é transcrição de uma fala completa; o runtime oficial informa que ele não tem streaming cache-aware. Nemotron foi desenhado para streaming em blocos e reaproveita o estado entre blocos ([guia de modelos do runtime](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/asr/models.md)).

## Recomendação prática

1. **Parakeet TDT 0.6B v3 já disponível como opção de ditado.** Nas dez amostras locais, foi mais preciso e rápido que o Small atual. O modelo ocupa cerca de 714 MB em disco, aproximadamente 3,8 vezes o Small. Ainda convém testar com ditados e colagem do dia a dia antes de torná-lo padrão.
2. **Candidato mais interessante para ditado contínuo: Nemotron 3.5 ASR 0.6B.** Ele é mais novo, tem locale explícito `pt-BR`, streaming cache-aware e WER FLEURS de 5,48%. Também ocupa cerca de 742 MB em Q8. O modelo é `openmdw-1.1`; conferir os termos antes de redistribuir em um serviço cloud.
3. **Qwen3-ASR 0.6B fica como terceiro teste.** É Apache-2.0, aceita contexto/hotwords e teve FLEURS pt de 6,21%, mas sua arquitetura é um speech-LLM: o GGUF Q8 oficial tem 805 MB e a execução exige um runtime próprio/llama.cpp. O resultado em MLC-SLM (34,97%) recomenda não assumir superioridade em fala espontânea brasileira.

Qwen ainda não foi medido nos dez áudios locais. Os resultados públicos não
substituem esse teste no computador do usuário.

### Nemotron 3.5 medido em 28/09/2026: descartado

Motivo do teste: no uso diário, o Parakeet às vezes decide que um ditado em
português é inglês e transcreve a frase inteira em inglês. O Parakeet v3 não
aceita idioma fixo; o Nemotron aceita `pt-BR`.

Nos dez áudios, com servidor quente (resultado bruto em
[asr-nemotron-vs-parakeet-2026-09-28.json](../outputs/asr-nemotron-vs-parakeet-2026-09-28.json)):

| | Parakeet v3 | Nemotron `pt-BR` | Nemotron automático |
|---|---|---|---|
| Mediana por áudio | 618 ms | 757 ms | 695 ms |
| Falhas graves | nenhuma | texto vazio em `06-tecnico`; frase cortada em `10-natural` | `06-tecnico` saiu em inglês ("To use Electron TypeScript...") |

O Nemotron também trocou palavras que o Parakeet acerta ("orçamento" virou
"estamento"). O WER normalizado penaliza o Parakeet em `03` e `08` só porque
ele escreve números em algarismos. Conclusão: o idioma fixo não resolveu, e o
Parakeet segue como motor de ditado. A deriva para o inglês passou a ser
tratada por um detector que retranscreve no Whisper com `pt` fixo
([language-guard.cjs](../src/main/services/language-guard.cjs)).

## Estado do runtime no Windows

O bloqueio antigo do roadmap merece nova avaliação: o [NeMo-Speech.cpp oficial](https://github.com/NVIDIA/NeMo-Speech.cpp) hoje oferece instalador PowerShell para Windows e lista Parakeet v3 e Nemotron 3.5; ele usa GGML nativo. Isso reduz a barreira de integração, mas ainda requer um teste real no Ryzen e não é compatível por simples troca do arquivo `.bin` do `whisper.cpp`.

**Fontes consultadas em 24/09/2026:** cards oficiais NVIDIA/Qwen no Hugging Face, relatório técnico Qwen3-ASR (arXiv, 29–30/01/2026), runtime NVIDIA NeMo-Speech.cpp e os dois repositórios de benchmark independentes citados acima.
