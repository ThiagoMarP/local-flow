# Local Flow — resumo da Fase 8

Fase concluída em 24 de junho de 2026.

## Distribuição

- Instalador NSIS por usuário, em pt-BR, gerado com `electron-builder`.
- Aplicativo empacotado em `app.asar`; binários e scripts como recursos.
- Somente o necessário do `whisper.cpp` é incluído (~10 MB).
- Instalador final com cerca de 100 MB; modelos baixados à parte.

## Primeiro uso

- Assistente de modelos no dashboard mostra mecanismo, modelos e Ollama.
- Download com progresso, validação de tamanho e gravação atômica.
- Modelos salvos em `%APPDATA%\Local Flow\models`, preservados em atualizações.

## Caminhos

- `app-paths.cjs` resolve dev e produção sem quebrar os testes.
- `process.resourcesPath` para binários; pasta gravável para modelos.

## Validação

- 57 testes unitários.
- Teste Electron de status de setup.
- `pack` e `dist` gerando pacote e instalador.
- Ciclo silencioso de instalação, verificação e desinstalação sem resíduos.
- Verificadores das fases 1 a 8.

O próximo marco é a Fase 9: atalho Ctrl+Win (toque duplo e segurar) com hook
de teclado nativo e nova cápsula compacta com logo, botões de cancelar e
confirmar.
