# NeMo-Speech.cpp para o Local Flow

Este diretório contém a release oficial **v0.1.0** do runtime de inferência da
NVIDIA para Windows x86_64 com backend **Vulkan** (GPU), que também roda na CPU.

- Arquivo de origem:
  <https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.1.0/nemo-speech-0.1.0-windows-x86_64-vulkan.zip>
- SHA-256 do ZIP publicado pela NVIDIA:
  `b5e7b04a637da4eb25a60253e2db65774998e8dfb48c08b4db763009b82ac7ac`
- Executável: `bin/nemo-speech.exe` (as DLLs necessárias ficam em `bin/`,
  incluindo `ggml-vulkan.dll`).

Como o app usa:

- O servidor aquecido roda com `--device auto` (GPU quando houver) e
  `GGML_VK_DISABLE_BFLOAT16=1`: drivers AMD antigos não têm a extensão de
  bfloat16 do Vulkan e, sem essa variável, o dispositivo nem sobe.
- O CLI é o plano B quando o servidor falha e roda sempre com `--device cpu`.
- Medido na Radeon 890M (driver de jan/2025): 5,2x mais rápido em ditados
  curtos e 6,1x em janelas de 2 min de reunião, com texto idêntico ao da CPU.
  Na CPU, este build tem o mesmo desempenho do build `cpu` anterior.
- Licença do runtime e avisos de terceiros: `share/licenses/nemo-speech/`.

O modelo é baixado separadamente pelo aplicativo:
`nvidia/parakeet-tdt-0.6b-v3`, arquivo
`parakeet-tdt-0.6b-v3.q8_0.gguf`, revisão
`541d1f99c6b0c3cd0b11a95167540bb8edefd82b`, 713.975.456 bytes,
SHA-256 `e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e`.
O modelo usa a licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
