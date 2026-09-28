# NeMo-Speech.cpp para o Local Flow

Este diretório contém a release oficial **v0.1.0** do runtime de inferência da
NVIDIA para Windows x86_64 CPU.

- Arquivo de origem:
  <https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.1.0/nemo-speech-0.1.0-windows-x86_64-cpu.zip>
- SHA-256 do ZIP publicado pela NVIDIA:
  `5e4ea81046012edcd77fd8848de8eefb5a4ba38cc26f52eb544ab184695a75d6`
- Executável: `bin/nemo-speech.exe` (as DLLs necessárias ficam em `bin/`).
- Licença do runtime e avisos de terceiros: `share/licenses/nemo-speech/`.

O modelo é baixado separadamente pelo aplicativo:
`nvidia/parakeet-tdt-0.6b-v3`, arquivo
`parakeet-tdt-0.6b-v3.q8_0.gguf`, revisão
`541d1f99c6b0c3cd0b11a95167540bb8edefd82b`, 713.975.456 bytes,
SHA-256 `e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e`.
O modelo usa a licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
