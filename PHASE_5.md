# Fase 5 — Estabilidade, organização e desempenho

## Estado

Concluída em 2026-06-23.

## Objetivo

Transformar o protótipo funcional em uma base sustentável para uso diário e para as próximas fases.

## Diagnóstico inicial

- `src/main/main.cjs` concentra aproximadamente 800 linhas.
- O renderer principal concentra captura, estado, configurações e autotestes.
- Configurações ainda vivem apenas na interface.
- Uma segunda execução pode criar outra instância.
- Suspensão, bloqueio de tela e falhas de renderer ainda não cancelam sessões.
- Não existe log estruturado nem política explícita de retenção.
- Limpeza temporária acontece por trabalho, mas não remove resíduos de falhas antigas.

## Arquitetura-alvo

```text
main.cjs
  └─ bootstrap e ciclo de vida
      ├─ SettingsStore
      ├─ PrivacyLogger
      ├─ WindowManager
      ├─ ShortcutService
      ├─ DictationService
      ├─ ClipboardService
      ├─ LoginItemService
      └─ HousekeepingService
```

## Escopo

### 1. Refatoração

- Reduzir `main.cjs` a composição e eventos do Electron.
- Separar gerenciamento de janelas e bandeja.
- Separar sessão de ditado e integração Windows.
- Separar clipboard e restauração.
- Manter módulos testáveis sem importar Electron quando possível.

### 2. Configurações persistentes

Arquivo `settings.json` dentro de `userData`, com:

- perfil do Whisper;
- vocabulário;
- atalho;
- microfone preferido;
- colagem automática;
- restauração do clipboard;
- duração máxima;
- iniciar com Windows;
- iniciar minimizado.

Requisitos:

- schema e valores padrão;
- validação em toda leitura e atualização;
- escrita atômica;
- recuperação automática de JSON inválido;
- atualização parcial sem perder campos.

### 3. Inicialização e instância única

- `requestSingleInstanceLock`.
- Segunda execução abre a janela da primeira.
- Suporte a `--hidden` para inicialização com Windows.
- `setLoginItemSettings` aplicado somente por ação/configuração do usuário.

### 4. Privacidade e logs

- Logs JSONL somente locais.
- Nunca registrar áudio, transcrição, clipboard ou vocabulário.
- Redigir campos potencialmente sensíveis.
- Rotação por tamanho e retenção limitada.
- Crash reports locais com `uploadToServer: false`.

### 5. Recuperação

- Cancelar gravação ao suspender ou bloquear a tela.
- Recuperar estado ocioso após falha do renderer.
- Tratar rejeições e exceções não capturadas.
- Recriar janelas quando seguro.
- Manter a transcrição no clipboard quando a colagem falhar.

### 6. Limpeza

- Remover trabalhos temporários antigos na inicialização.
- Limpar arquivos de log excedentes.
- Remover capturas ou arquivos transitórios apenas da área gerenciada.
- Não apagar amostras, modelos ou arquivos do usuário.

### 7. Desempenho

- Evitar instâncias duplicadas.
- Carregar apenas serviços necessários.
- Manter auxiliar Windows persistente.
- Limitar atualizações de nível de áudio.
- Evitar gravação ou serialização de conteúdo sensível.
- Medir memória e tempo de inicialização antes e depois.

## Critérios de saída

- `main.cjs` substancialmente menor e com responsabilidades claras.
- Configurações sobrevivem ao reinício.
- JSON inválido é recuperado sem impedir inicialização.
- Segunda instância não duplica Electron/Whisper.
- Opção de iniciar com Windows é funcional.
- Logs não contêm texto ditado ou clipboard.
- Logs e temporários possuem retenção limitada.
- Bloqueio/suspensão cancela a gravação.
- Todos os testes anteriores continuam aprovados.
- Novos testes de configuração, logging, limpeza e instância passam.

## Entrega realizada

- `main.cjs` reduzido de aproximadamente 800 para cerca de 600 linhas.
- Gerenciamento de janelas, configurações, clipboard, login, logs,
  limpeza e automação de testes separados em serviços.
- Configurações persistentes com escrita atômica, validação e
  recuperação de JSON inválido.
- Interface para microfone, atalho, duração máxima, colagem,
  restauração do clipboard e inicialização com Windows.
- Instância única validada com duas execuções reais do Electron.
- Logs JSONL locais com redação de conteúdo sensível e retenção.
- Cancelamento ao suspender ou bloquear a tela.
- Recuperação de renderer e tratamento de falhas não capturadas.
- Limpeza de temporários antigos restrita à pasta gerenciada.
- Cápsula flutuante carregada sob demanda no uso normal.

## Medições

- Bootstrap sem renderers: 102–103 MB de conjunto residente.
- Inicialização do bootstrap: 95–158 ms nas execuções medidas.
- Aplicativo completo em repouso antes da otimização: 281,7 MB.
- Aplicativo completo em repouso após cápsula sob demanda: 246,1 MB.
- Redução observada em repouso: aproximadamente 35,6 MB, ou 13%.

As medidas são amostras locais do Electron em Windows e podem variar
entre execuções. O tempo de transcrição continua dominado pelo modelo
Whisper escolhido.

## Validação final

- 25 testes unitários aprovados.
- Persistência entre reinícios aprovada.
- Instância única aprovada.
- Smoke test, bandeja, ciclo de vida e atalho aprovados.
- Inserção automática com restauração do clipboard aprovada.
- Pipeline Whisper completo aprovado em 2,0 segundos para 6,1
  segundos de áudio no perfil rápido.
- Autoteste do microfone aprovado.
- Verificadores das fases 1 a 5 aprovados.
