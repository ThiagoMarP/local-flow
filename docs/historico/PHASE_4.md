# Fase 4 — Atalho global e inserção automática

## Estado

Implementada em 2026-06-23. Aguardando confirmação física do atalho pelo usuário.

## Objetivo

Permitir o uso do Local Flow sem abrir ou focar o painel:

```text
atalho global → falar → atalho → transcrever → colar no aplicativo ativo
```

## Decisão de interação

O primeiro modo será **alternar**:

- primeiro `Ctrl+Shift+Espaço`: inicia a gravação;
- segundo `Ctrl+Shift+Espaço`: encerra e transcreve.

A API `globalShortcut` do Electron informa o pressionamento, mas não fornece um evento de liberação. Um modo “segurar para falar” exigirá um hook nativo adicional e não bloqueará esta entrega.

## Escopo

### 1. Atalho global

- Registrar `CommandOrControl+Shift+Space` depois de `app.ready`.
- Validar retorno da API e estado com `isRegistered`.
- Exibir o atalho no painel e na bandeja.
- Aplicar debounce para impedir repetição automática da tecla.
- Remover todos os atalhos em `will-quit`.

### 2. Sessão de ditado

- Capturar a janela em primeiro plano no primeiro toque.
- Se o alvo for o próprio Local Flow, usar apenas clipboard.
- Comandar o renderer oculto para iniciar o microfone.
- No segundo toque, comandar encerramento e transcrição.
- Bloquear sessões simultâneas.

### 3. Integração Windows

Criar um auxiliar local persistente para:

- ler o identificador da janela em primeiro plano;
- confirmar que a janela ainda existe;
- restaurar essa janela;
- enviar `Ctrl+V`.

O auxiliar usará somente APIs locais do Windows e não terá acesso à rede.

### 4. Clipboard

- Capturar conteúdo textual anterior.
- Escrever a transcrição.
- Retornar foco ao aplicativo original.
- Enviar `Ctrl+V`.
- Restaurar o texto anterior após a colagem.
- Se a colagem falhar, manter a transcrição no clipboard.

Nesta fase, a restauração será garantida para conteúdo textual. Preservação completa de imagens e formatos personalizados será tratada na fase de estabilidade.

### 5. Interface

- Exibir atalho e modo alternar no painel.
- Atualizar cápsula sem abrir ou focar o painel.
- Mostrar sucesso quando o texto for colado.
- Informar claramente quando apenas foi copiado.

## Arquitetura prevista

```text
globalShortcut
    ↓
Processo principal captura HWND
    ↓
Renderer oculto grava microfone
    ↓
Whisper local transcreve
    ↓
Clipboard recebe texto
    ↓
Auxiliar Windows restaura HWND e envia Ctrl+V
```

## Testes

- Registro e remoção do atalho.
- Debounce do controlador.
- Captura de janela ativa.
- Colagem em uma janela local de teste.
- Restauração do clipboard textual.
- Fallback quando o alvo desaparece.
- Regressão de microfone, Whisper, cápsula e bandeja.

## Resultado técnico

- `Ctrl+Shift+Espaço` registrado com sucesso.
- `Ctrl+Alt+Espaço` foi descartado porque já estava ocupado no computador.
- Controlador de alternância com debounce implementado.
- Janela ativa capturada por identificador nativo do Windows.
- Colagem real validada em janela local.
- Clipboard textual restaurado após a colagem.
- Fallback direto para controles nativos quando o Windows recusa troca de foco.
- Falhas de foco mantêm a transcrição disponível no clipboard.

## Validação automatizada

- 14 testes unitários aprovados.
- Registro do atalho aprovado.
- Inserção real aprovada.
- Restauração do clipboard aprovada.
- Teste Electron completo aprovado.
- Microfone, Whisper, cápsula e bandeja sem regressões.

## Validação manual pendente

Confirmar fisicamente:

1. manter o Local Flow em execução;
2. focar um campo de texto;
3. pressionar `Ctrl+Shift+Espaço`;
4. falar;
5. pressionar `Ctrl+Shift+Espaço` novamente;
6. verificar a inserção do texto.

## Critérios de saída

- Atalho funciona com o painel oculto.
- Dois toques controlam uma sessão completa.
- A cápsula acompanha a sessão sem receber foco.
- Texto é inserido na janela anteriormente ativa.
- Clipboard textual é restaurado após sucesso.
- Falha de foco ou colagem mantém o texto disponível.
- Atalho é removido ao encerrar.
- Fluxos das Fases 2 e 3 continuam aprovados.
