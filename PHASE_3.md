# Fase 3 — Aplicativo desktop e cápsula flutuante

## Estado

Planejada em 2026-06-23.

Este plano deve ser seguido antes de iniciar a integração com atalhos globais da Fase 4.

## Objetivo

Transformar o protótipo da Fase 2 em um aplicativo Windows persistente, com painel principal, cápsula flutuante e bandeja do sistema.

## Escopo

### 1. Gerenciamento de janelas

- Renomear conceitualmente a janela atual para painel principal.
- Criar uma segunda janela:
  - sem moldura;
  - transparente;
  - sempre no topo;
  - ausente da barra de tarefas;
  - sem roubar o foco.
- Posicionar a cápsula no centro inferior da área útil da tela.
- Reposicionar quando a resolução ou a área útil mudar.

### 2. Estados compartilhados

Definir um contrato único:

```text
idle
recording
processing
success
error
```

O painel envia estado e nível do microfone ao processo principal. O processo principal replica o estado para a cápsula.

### 3. Comportamento da cápsula

- `idle`: oculta.
- `recording`: forma de onda e cronômetro.
- `processing`: indicador animado e nome do perfil.
- `success`: confirmação breve.
- `error`: erro resumido e fechamento posterior.

### 4. Bandeja do sistema

Criar um ícone e menu com:

- Abrir Local Flow.
- Mostrar/ocultar painel.
- Informar o perfil ativo.
- Sair.

Fechar o painel deverá ocultá-lo. A opção **Sair** encerrará o processo.

### 5. Painel principal

- Manter gravação, seleção de modelo, vocabulário e resultado.
- Mostrar que o aplicativo permanece na bandeja.
- Adicionar controles de demonstração dos estados da cápsula durante desenvolvimento.
- Preservar o funcionamento da Fase 2.

## Fora do escopo

- Atalho global.
- Colagem automática no aplicativo anterior.
- Inicialização automática com o Windows.
- Configuração persistente.
- Revisão com Ollama.

## Arquitetura prevista

```text
Painel renderer
  ├─ captura do microfone
  ├─ controles e configurações
  └─ envia estado visual
          ↓
Processo principal
  ├─ gerencia painel
  ├─ gerencia cápsula
  ├─ gerencia bandeja
  └─ encaminha estado
          ↓
Cápsula renderer
  └─ representa estado sem receber foco
```

## Ordem de implementação

1. Extrair contrato de estados.
2. Criar janela e renderer da cápsula.
3. Sincronizar estados do painel.
4. Implementar posicionamento multimonitor.
5. Criar bandeja e ciclo ocultar/mostrar/sair.
6. Adaptar testes automáticos.
7. Capturar e revisar painel e cápsula.
8. Atualizar documentação e marcar a fase como concluída.

## Critérios de saída

- Painel e cápsula abrem sem erro.
- A cápsula não recebe foco.
- A cápsula acompanha todos os estados.
- O indicador de volume reage durante a gravação.
- Fechar o painel mantém o aplicativo ativo.
- O painel pode ser reaberto pela bandeja.
- A opção **Sair** encerra todas as janelas.
- Transcrição e clipboard da Fase 2 continuam funcionando.
- Testes automatizados e revisão visual aprovados.

