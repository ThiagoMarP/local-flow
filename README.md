# Local Flow

Aplicativo de ditado e transcrição **local** para Windows. Fale em qualquer
aplicativo e insira o texto sem sair do contexto. Sem nuvem e sem contas: o
áudio é processado no seu computador. No ditado, ele é descartado após a
transcrição; nas reuniões, a gravação fica no histórico local até você a excluir.

## Recursos

- Captura por atalho global, com inserção automática no aplicativo ativo.
- Transcrição offline em português com `whisper.cpp` (Small, Medium e Large V3
  Turbo) ou Parakeet TDT 0.6B v3 no ditado.
- Revisão opcional por LLM local via Ollama (modos limpo,
  inteligente e Prompt para IA), com retorno seguro ao texto original.
- Limpeza rápida sem Ollama: corrige autocorreções explícitas, listas e algumas
  repetições evidentes sem atrasar a inserção do texto.
- [Limpeza leve experimental](docs/LIMPEZA-LEVE.md), com correções explícitas
  rápidas e opção de copiar a transcrição original no histórico.
- Personalização local: dicionário de contexto, substituições, snippets e
  perfis de escrita.
- Cápsula flutuante que mostra o estado da gravação sem roubar o foco.
- Gravação e transcrição de reuniões com microfone e áudio do sistema, salvas no
  histórico local.
- Privacidade por padrão: logs apenas com metadados, sem conteúdo do usuário.

## Requisitos

- Windows 10 ou 11 (64 bits).
- Espaço para os modelos escolhidos: Small ~190 MB; Parakeet ~681 MB.
- Opcional: [Ollama](https://ollama.com) instalado para os modos de revisão com
  IA. Literal e Limpeza rápida funcionam sem ele; a Limpeza leve também funciona
  sem ele nos casos rápidos reconhecidos.

## Download

Baixe o instalador `Local.Flow.Setup.X.Y.Z.exe` na página de
[Releases](https://github.com/ThiagoMarP/local-flow/releases/latest) e execute.

> **Aviso do Windows:** o instalador ainda não tem assinatura digital. O
> SmartScreen pode mostrar "O Windows protegeu o computador": clique em **Mais
> informações** e depois em **Executar assim mesmo**. Se o seu PC tiver o Smart
> App Control ligado e ele bloquear sem essa opção, ainda não é possível
> instalar nesse computador. O código-fonte está aberto para você conferir e
> compilar por conta própria.

## Instalação

A forma recomendada é o instalador `.exe`. Consulte
[docs/INSTALL.md](docs/INSTALL.md) para o passo a passo de instalação, download
de modelos no primeiro uso e desinstalação.

Na primeira execução, abra o painel **Modelos de voz e mecanismo** e baixe pelo
menos um modelo. Para testar o Parakeet, baixe **Parakeet TDT 0.6B v3** e
selecione-o em **Configurações → Perfil do modelo**. O perfil padrão é o Medium;
a transcrição de reuniões continua usando os perfis Whisper.

## Uso rápido

1. Posicione o cursor onde quer escrever (e-mail, editor, chat).
2. Acione o atalho global de ditado.
3. Fale. Acione o atalho novamente para transcrever e inserir.

Pressione **Esc** durante a gravação ou transcrição do ditado para cancelar
antes da colagem. Depois que o texto já foi enviado ao campo, o Esc não desfaz
a inserção.

Enquanto o ditado está ativo, a bolinha flutuante aparece no topo do monitor
onde está o cursor e muda de monitor quando você move o mouse para outra tela.

No painel, **Cancelar ditado (Esc)** encerra o ditado sem transcrever. Na aba
**Reuniões**, use **Iniciar gravação** e **Parar reunião**; o áudio é salvo em
blocos locais e a transcrição continua em segundo plano. Se o aplicativo for
interrompido, ele tenta processar os blocos já salvos na próxima abertura.
Para transcrever reuniões, instale o perfil Whisper escolhido nas configurações.

O ícone na bandeja mantém o aplicativo disponível em segundo plano e mostra o
atalho ativo e o perfil atual.

## Desenvolvimento

```powershell
npm install          # instala dependências
npm run electron:install
.\scripts\setup-whisper.ps1 -Profile all   # baixa binário e modelos no dev
npm start            # abre o aplicativo
npm test             # testes unitários
```

### Empacotamento

```powershell
npm run pack         # build sem instalador (pasta dist/win-unpacked)
npm run dist         # gera o instalador NSIS em dist/
```

Os modelos **não** são incluídos no instalador: são baixados pelo assistente na
primeira execução e ficam na pasta de dados do usuário.

## Privacidade

O áudio do ditado é temporário e removido após a transcrição. Reuniões mantêm
áudio, transcrição e resumo no histórico local até serem excluídas. Nenhum
dado de áudio é enviado a servidores externos; a revisão por LLM, quando
ativada, usa um Ollama local.
Veja `DECISIONS.md` para o registro completo de decisões de privacidade.

## Licença

Código sob a [licença MIT](LICENSE). Os componentes de terceiros (whisper.cpp,
NeMo-Speech.cpp, modelos Whisper e Parakeet) mantêm as suas próprias licenças,
listadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
