# Registro de decisões

## 2026-06-23 — Produto local primeiro

O produto funcionará offline depois do download dos modelos. A privacidade e a ausência de limites de palavras têm prioridade sobre sincronização ou recursos de nuvem.

## 2026-06-23 — Electron no primeiro ciclo

Electron foi escolhido para validar rapidamente microfone, atalhos globais e interface. Uma migração futura para Tauri só será considerada depois de medir consumo e estabilidade do produto funcional.

## 2026-06-23 — whisper.cpp como mecanismo inicial

O `whisper.cpp` oferece binário nativo, quantização e execução em CPU. A linha de base será medida em CPU. Vulkan será avaliado separadamente para a Radeon 890M após a instalação de uma cadeia de compilação adequada.

## 2026-06-23 — Benchmark antes da interface

Nenhuma decisão visual ou integração complexa deve esconder um problema de precisão ou latência. O modelo padrão será escolhido com amostras reais antes da construção do aplicativo.

## 2026-06-23 — Áudio efêmero

Áudios do uso normal serão temporários e apagados depois da transcrição. As amostras da pasta de benchmark são uma exceção explícita e controlada pelo usuário.

