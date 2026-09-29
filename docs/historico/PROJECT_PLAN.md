# Local Flow — Plano de execução

Última atualização: 2026-06-24

Este documento é a fonte de verdade do projeto. Uma fase só é marcada como concluída quando sua entrega funciona e os critérios de saída foram registrados.

## Objetivo

Criar um aplicativo Windows de ditado local, sem limite de palavras, com:

- captura por atalho global;
- transcrição offline em português;
- interface flutuante;
- inserção no aplicativo ativo;
- revisão opcional por LLM local;
- privacidade local por padrão.

## Estado atual

| Fase | Estado | Entrega |
|---|---|---|
| 0. Arquitetura e ambiente | Concluída | Stack e restrições definidas |
| 1. Benchmark do Whisper | Concluída | Perfis Small, Medium e Large V3 Turbo definidos |
| 2. Núcleo funcional | Concluída | Microfone → transcrição → clipboard |
| 3. Aplicativo desktop | Concluída | Interface, cápsula e bandeja do sistema |
| 4. Integração com Windows | Concluída | Atalho e inserção automática |
| 5. Estabilidade | Concluída | Configurações, privacidade, recuperação e otimização |
| 6. Revisão inteligente | Concluída | Modos literal, limpo e inteligente com fallback |
| 7. Personalização | Concluída | Dicionário, substituições, snippets e perfis |
| 8. Distribuição | Concluída | Instalador NSIS testado e assistente de modelos |
| 9. Ergonomia do atalho e cápsula | Em andamento | Ctrl+Win nativo e cápsula compacta |

## Fase 0 — Arquitetura e ambiente

### Decisões concluídas

- Windows é a primeira plataforma.
- Electron, React e TypeScript serão usados no primeiro produto.
- `whisper.cpp` será o mecanismo inicial de transcrição.
- Ollama será usado apenas na etapa opcional de revisão.
- Áudio não será armazenado por padrão.
- A primeira linha de base será executada em CPU.

### Ambiente detectado

- CPU: AMD Ryzen AI 9 HX 370, 24 threads lógicas.
- Memória: aproximadamente 32 GB.
- GPU integrada: AMD Radeon 890M.
- Node.js 24 e npm 11 instalados.
- Git e Ollama instalados.
- Rust, CMake e FFmpeg ainda não disponíveis.
- Modelos Ollama existentes: `qwen2.5:3b` e `qwen2.5:7b`.

## Fase 1 — Benchmark do Whisper

### Objetivo

Escolher o modelo e o backend com melhor equilíbrio entre qualidade em português, latência e uso de recursos.

### Escopo

1. Instalar uma versão reproduzível do `whisper.cpp`.
2. Baixar modelos quantizados candidatos.
3. Gravar um conjunto padronizado de frases.
4. Transcrever cada amostra com cada modelo.
5. Medir:
   - tempo total;
   - fator de tempo real;
   - taxa de erro por palavras (WER);
   - estabilidade;
   - erros em nomes, números e termos técnicos.
6. Registrar uma recomendação.

### Candidatos iniciais

- `small` quantizado: opção rápida.
- `medium` quantizado: opção equilibrada.
- `large-v3-turbo` quantizado: opção de maior qualidade, se a latência for aceitável.

### Critérios de saída

- Pelo menos dez amostras reais em português.
- Dez execuções consecutivas sem falha no modelo escolhido.
- Resultado compreensível em todas as frases de uso comum.
- Latência adequada para ditados curtos.
- Modelo rápido e modelo padrão definidos.
- Resultados registrados em `benchmarks/results/`.

### Entregas da fase

- `scripts/setup-whisper.ps1`: baixa binário e modelos.
- `scripts/record-samples.mjs`: abre um gravador local de WAV.
- `scripts/benchmark.mjs`: executa os testes e gera relatório.
- `benchmarks/prompts.json`: frases e textos esperados.
- `benchmarks/results/`: relatórios produzidos.

### Decisão final

- Perfil rápido: `small-q5_1`.
- Perfil padrão: `medium-q5_0`.
- Perfil de precisão: `large-v3-turbo-q5_0`.
- Backend inicial: CPU com até 24 threads.
- Vocabulário pessoal será enviado como prompt inicial ao Whisper.
- Vulkan permanece como otimização futura, não como dependência do MVP.

## Fase 2 — Núcleo funcional

Construir o pipeline:

```text
microfone → WAV 16 kHz → Whisper → texto → clipboard
```

Critérios: cinco ditados consecutivos, limpeza de arquivos temporários e tratamento de falhas.

## Fase 3 — Aplicativo desktop

Criar bandeja, cápsula flutuante, forma de onda e estados visuais sem roubar o foco do aplicativo ativo.

## Fase 4 — Integração com Windows

Adicionar atalho global, modos pressionar/segurar, preservação do clipboard e inserção no campo anteriormente ativo.

## Fase 5 — Estabilidade

Adicionar configurações, inicialização com Windows, logs sem conteúdo sensível, limpeza automática e recuperação de falhas.

### Resultado

- Configurações persistentes e editáveis na interface.
- Instância única e inicialização opcional com Windows.
- Logs locais com redação e retenção.
- Recuperação de falhas, suspensão e bloqueio de tela.
- Código dividido em serviços testáveis.
- Redução aproximada de 13% da memória em repouso com cápsula sob demanda.

## Fase 6 — Revisão inteligente

Adicionar modos literal, limpo e inteligente usando Ollama, sempre com fallback para a transcrição original.

### Resultado

- `qwen2.5:3b` definido como modelo padrão de revisão.
- `qwen2.5:7b` disponível como alternativa instalada.
- Ollama permanece opcional; literal é o padrão.
- Respostas inseguras, indisponibilidade e timeout preservam o
  resultado original do Whisper.
- Interface mostra modo, modelo e disponibilidade local.

## Fase 7 — Personalização

Adicionar dicionário pessoal, snippets, substituições e perfis de escrita.

### Resultado

- Dicionário contextual persistente para o Whisper.
- Substituições determinísticas sem cascata.
- Snippets multilinha preservados após a revisão por LLM.
- Perfis neutro, conciso, profissional e casual.
- Editor local de regras integrado à interface.
- Custo médio de 0,18 ms com o limite de 150 regras.

## Fase 8 — Distribuição

Gerar instalador `.exe`, assistente de modelos, documentação, testes de instalação e desinstalação.

### Resultado

- Instalador NSIS por usuário, em pt-BR, via `electron-builder`.
- Caminhos cientes de empacotamento: binário em `resourcesPath`, modelos em
  pasta gravável.
- Assistente de modelos baixa os perfis com progresso e validação.
- Documentação `README.md` e `docs/INSTALL.md`.
- Ciclo silencioso de instalação e desinstalação testado sem resíduos.

## Fase 9 — Ergonomia do atalho e cápsula

Substituir o gatilho principal por `Ctrl+Win` usando um hook de teclado nativo,
com duas formas de ditar, e redesenhar a cápsula concluída.

- Toque duplo rápido em `Ctrl+Win`: inicia e fixa a gravação; novo toque duplo
  encerra.
- Segurar `Ctrl+Win`: grava enquanto pressionado e transcreve ao soltar.
- Atalho acelerador anterior permanece como alternativa configurável.
- Cápsula concluída menor, com logo, botão de cancelar e botão de confirmar.

## Fora do primeiro ciclo

- Aplicativos móveis.
- Sincronização em nuvem.
- Contas de usuário.
- Transcrição de reuniões com diarização.
- Uso da NPU.
- macOS e Linux.
