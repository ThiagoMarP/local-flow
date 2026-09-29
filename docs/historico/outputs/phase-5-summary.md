# Local Flow — resumo da Fase 5

Fase concluída em 23 de junho de 2026.

## O que mudou

- Código principal dividido em serviços menores e testáveis.
- Configurações persistentes com validação e recuperação.
- Seleção de microfone, atalho e duração máxima.
- Opções de colagem, restauração do clipboard e início com Windows.
- Instância única.
- Logs locais sem conteúdo sensível.
- Limpeza e retenção de arquivos gerenciados.
- Recuperação após suspensão, bloqueio ou falha de renderer.
- Cápsula flutuante carregada apenas quando necessária.

## Desempenho medido

- Bootstrap: 95–158 ms e aproximadamente 102–103 MB.
- Repouso antes: 281,7 MB.
- Repouso depois: 246,1 MB.
- Redução observada: aproximadamente 35,6 MB ou 13%.

## Validação

- 25 testes unitários.
- Persistência entre reinícios.
- Instância única.
- Smoke, bandeja, ciclo de vida e atalho global.
- Inserção no aplicativo ativo com restauração do clipboard.
- Transcrição completa pelo Whisper.
- Captura real do microfone.
- Verificadores das fases 1 a 5.

O próximo marco é a Fase 6: revisão opcional da transcrição com Ollama,
mantendo fallback imediato para o texto original.
