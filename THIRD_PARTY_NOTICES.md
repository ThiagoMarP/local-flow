# Avisos de terceiros

O Local Flow é distribuído sob a licença MIT (veja `LICENSE`). Ele usa os
componentes abaixo, cada um sob a sua própria licença.

| Componente | Uso | Licença |
| --- | --- | --- |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (v1.9.1) | Binários de transcrição (`whisper-cli`, `ggml`) incluídos no instalador | MIT |
| [Modelos Whisper (OpenAI)](https://github.com/openai/whisper), convertidos por ggerganov | Baixados no primeiro uso (Small, Medium, Large V3 Turbo) | MIT |
| [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) (v0.1.0, NVIDIA) | Runtime do Parakeet incluído no instalador | Apache 2.0 |
| [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) (NVIDIA) | Modelo baixado no primeiro uso (versão quantizada q8_0 em GGUF) | CC BY 4.0 |
| [Electron](https://www.electronjs.org/) | Base do aplicativo | MIT |
| [Ollama](https://ollama.com) | Opcional, instalado pelo usuário; o Local Flow apenas se conecta a ele | MIT |

## Detalhes

- **Parakeet TDT 0.6B v3**: modelo de NVIDIA, licenciado sob
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). O Local Flow baixa
  uma versão quantizada (q8_0) em formato GGUF, sem redistribuí-la no
  instalador.
- **NeMo-Speech.cpp**: o texto da licença e os avisos completos ficam em
  `native/parakeet/share/licenses/nemo-speech/` e são copiados para o
  instalador.
- **Modelos de revisão (LLM)**: não fazem parte do Local Flow. Quem instala o
  Ollama escolhe e baixa os modelos, e cada um tem a licença do seu autor.

As dependências de desenvolvimento (por exemplo `electron-builder`) não são
distribuídas dentro do aplicativo e têm licenças próprias, listadas em
`package-lock.json`.
