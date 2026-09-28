# Fase 8 — Distribuição

## Estado

Concluída em 2026-06-24.

## Objetivo

Transformar o Local Flow em um produto instalável: gerar um instalador `.exe`
testado, um assistente de modelos para o primeiro uso, documentação para o
usuário final e um ciclo automatizado de instalação e desinstalação.

## Recursos

### Instalador Windows (NSIS)

- `electron-builder` com alvo NSIS, configurado em `electron-builder.yml`.
- Instalação **por usuário** (sem privilégios de administrador).
- Assistente em pt-BR, com escolha de pasta e atalhos no menu Iniciar e na
  área de trabalho.
- O código do aplicativo é empacotado em `app.asar`.
- Binários nativos e scripts PowerShell viajam como `extraResources` em disco,
  porque não podem ser executados de dentro do asar.
- Apenas o necessário do `whisper.cpp` é incluído: `whisper-cli.exe`,
  `whisper.dll`, `ggml.dll`, `ggml-base.dll` e as variantes `ggml-cpu-*.dll`.
- Instalador final com cerca de 100 MB.

### Caminhos cientes de empacotamento

- Novo serviço `app-paths.cjs` resolve binário, scripts e modelos tanto na
  árvore de desenvolvimento quanto na instalação empacotada.
- No modo empacotado, o binário vem de `process.resourcesPath` e os modelos
  ficam em `%APPDATA%\Local Flow\models` (gravável).
- `LOCAL_FLOW_MODELS_DIR` permite redirecionar a pasta de modelos.

### Assistente de modelos

- Serviço `model-installer.cjs` baixa os três modelos com progresso,
  validação de tamanho e renomeação atômica (`.part` → final).
- Transporte injetável: a lógica é testável sem rede.
- Painel **Modelos de voz e mecanismo** no dashboard mostra a prontidão do
  mecanismo, de cada modelo e do Ollama, com botões de download e barra de
  progresso. O painel abre sozinho quando o modelo do perfil ativo falta.
- IPC `setup:status`, `setup:download` e `setup:cancel`, com eventos de
  progresso.

### Documentação

- `README.md`: visão geral, requisitos, uso e empacotamento.
- `docs/INSTALL.md`: instalação, download de modelos, atualização,
  desinstalação e solução de problemas.

## Modelos fora do instalador

Os modelos somam mais de 1,2 GB e mudam de forma independente do aplicativo.
Por isso não entram no instalador: são baixados pelo assistente na primeira
execução e ficam na pasta de dados do usuário, preservados entre atualizações
e reinstalações.

## Critérios de saída

- Instalador `.exe` gerado por `npm run dist`.
- Aplicativo empacotado encontra o mecanismo e os modelos pelos novos caminhos.
- Assistente baixa modelos e habilita o perfil correspondente.
- Documentação de instalação e desinstalação disponível.
- Ciclo de instalação e desinstalação testado e sem resíduos.
- Todos os testes e verificadores anteriores continuam aprovados.

## Validação final

- 57 testes unitários aprovados (11 novos: `app-paths` e `model-installer`,
  além do novo modo de execução).
- Teste Electron `test:setup` confirma o status de setup com o mecanismo
  pronto e três modelos rastreados.
- `npm run pack` e `npm run dist` geram o pacote e o instalador.
- O pacote empacotado responde com `packaged: true` e `whisperAvailable: true`.
- `scripts/install-test.ps1` executou instalação silenciosa, verificação
  headless do app instalado e desinstalação, sem deixar resíduos no registro
  ou em disco (`INSTALL_TEST_PASSED`).
- Verificador `phase8:check` aprovado.

## Entrega realizada

- Pipeline de empacotamento `electron-builder` (pack e dist).
- Resolução de caminhos para dev e produção sem quebrar os testes existentes.
- Serviço de download de modelos com progresso e validação.
- Assistente de modelos integrado ao dashboard.
- Documentação para o usuário final.
- Script de teste de instalação e desinstalação.
