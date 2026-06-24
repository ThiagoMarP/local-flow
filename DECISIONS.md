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

## 2026-06-23 — Perfis de modelo

O aplicativo oferecerá três perfis:

- rápido: `small-q5_1`;
- padrão: `medium-q5_0`;
- precisão: `large-v3-turbo-q5_0`.

O Medium será o padrão inicial por equilibrar precisão e latência. O usuário poderá trocar o perfil sem alterar a arquitetura.

## 2026-06-23 — Vocabulário como contexto

O dicionário pessoal será convertido em um prompt inicial do Whisper. O benchmark mostrou que isso corrige termos como `Ollama` mesmo no modelo Small.

## 2026-06-23 — CPU primeiro

O MVP usará CPU com até 24 threads. Vulkan pode reduzir latência na Radeon 890M, mas exige uma cadeia de compilação adicional. Essa otimização será avaliada depois do pipeline funcional.

## 2026-06-23 — Captura no renderer, transcrição no processo principal

O renderer captura e converte o microfone para WAV PCM de 16 kHz. O processo principal valida o arquivo, executa o `whisper.cpp`, controla arquivos temporários e escreve no clipboard. A ponte expõe apenas operações específicas por `contextBridge`.

## 2026-06-23 — Janela persistente e bandeja

A partir da Fase 3, fechar o painel principal ocultará a janela em vez de encerrar o aplicativo. O encerramento explícito ficará disponível na bandeja do sistema.

## 2026-06-23 — Cápsula somente visual

A cápsula não recebe foco nem eventos do mouse. Sua função é representar o estado da gravação sem interromper o aplicativo em que o usuário está trabalhando. Interações e configurações permanecem no painel principal.

## 2026-06-23 — Estado centralizado no processo principal

O painel publica um contrato restrito de estado. O processo principal normaliza esse conteúdo e o encaminha para a cápsula. Isso permite que o atalho global da Fase 4 reutilize a mesma interface sem acoplamento direto entre janelas.

## 2026-06-23 — Atalho em modo alternar

O atalho inicial será `Ctrl+Shift+Espaço`: um toque inicia e o segundo encerra. `Ctrl+Alt+Espaço` foi testado, mas já estava ocupado no Windows. O modo pressionar/soltar exigirá hook de teclado nativo e fica como evolução.

## 2026-06-23 — Auxiliar Windows persistente

Captura de janela, retorno de foco e colagem são executados por um processo PowerShell local persistente com chamadas diretas ao `user32.dll`. Isso evita dependências nativas externas e reduz a latência de inicialização.

## 2026-06-23 — Configuração local versionada

As preferências ficam em `settings.json` dentro de `userData`. Toda
leitura passa por normalização de schema, atualizações são parciais e a
gravação usa arquivo temporário seguido de renomeação. Um arquivo
inválido é preservado como backup e substituído pelos padrões.

## 2026-06-23 — Logs sem conteúdo do usuário

Logs são JSONL locais e registram apenas metadados operacionais.
Áudio, transcrição, clipboard, vocabulário e campos equivalentes são
redigidos. Crash reports permanecem locais e não são enviados.

## 2026-06-23 — Cápsula carregada sob demanda

No uso normal, o renderer da cápsula só é criado quando o estado deixa
de ser ocioso. Isso reduz o consumo em repouso sem alterar a experiência
durante o ditado. Os testes automatizados mantêm criação imediata para
validar foco, posição e renderização.
