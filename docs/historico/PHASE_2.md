# Fase 2 — Núcleo funcional

## Estado

Concluída em 2026-06-23.

## Entrega

Aplicativo Electron mínimo que:

1. solicita acesso ao microfone;
2. captura áudio mono;
3. converte para WAV PCM, 16 kHz e 16 bits;
4. executa o `whisper.cpp` local;
5. exibe o resultado;
6. copia a transcrição para o clipboard;
7. remove o arquivo temporário.

## Limites desta fase

- Ainda não existe atalho global.
- Ainda não existe colagem automática no aplicativo anterior.
- A janela ainda é um protótipo, não a cápsula flutuante final.
- O usuário inicia e encerra a gravação por botões.

Esses itens pertencem às Fases 3 e 4.

## Execução

```powershell
npm.cmd run electron:install
npm.cmd start
```

## Verificações automatizadas

```powershell
npm.cmd test
npm.cmd run test:core
npm.cmd run smoke
npm.cmd run phase2:check
```

## Critérios de saída

- [x] Aplicativo abre sem erro.
- [x] Permissão do microfone é solicitada corretamente.
- [x] Cinco gravações consecutivas são transcritas.
- [x] Resultado é copiado para o clipboard.
- [x] Áudio temporário é removido depois da execução.
- [x] Perfis Small, Medium e Large V3 Turbo podem ser selecionados.
- [x] Uma segunda transcrição simultânea é bloqueada.

## Resultados

- Sete testes unitários aprovados.
- Cinco transcrições consecutivas aprovadas sem resíduos temporários.
- Autoteste do microfone:
  - entrada: 48 kHz;
  - 11 blocos capturados;
  - WAV local de 30.082 bytes.
- Teste Electron completo:
  - amostra de 6,144 segundos;
  - transcrição em 2,089 segundos;
  - texto confirmado no clipboard.
- Interface renderizada e inspecionada em `work/phase-2-ui.png`.

## Próxima fase

Separar a experiência em:

- painel principal de configurações;
- cápsula flutuante de estado;
- bandeja do sistema;
- execução persistente em segundo plano.
