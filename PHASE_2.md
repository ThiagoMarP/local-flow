# Fase 2 — Núcleo funcional

## Estado

Em andamento.

O núcleo, os testes e a interface já foram implementados. A abertura da janela e o teste manual do microfone dependem apenas do download do executável do Electron, bloqueado temporariamente pelo limite de autorização do ambiente.

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

- Aplicativo abre sem erro.
- Permissão do microfone é solicitada corretamente.
- Cinco gravações consecutivas são transcritas.
- Resultado é copiado para o clipboard.
- Áudio temporário é removido mesmo quando ocorre falha.
- Perfis Small, Medium e Large V3 Turbo podem ser selecionados.
- Uma segunda transcrição simultânea é bloqueada.
