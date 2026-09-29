# Instalação e desinstalação do Local Flow

## 1. Instalar

1. Baixe o arquivo `Local.Flow.Setup.x.y.z.exe`.
2. Execute o instalador. Ele é **por usuário** e não exige privilégios de
   administrador.
3. Escolha a pasta de instalação (opcional) e conclua. Serão criados atalhos no
   menu Iniciar e na área de trabalho.

> O instalador não é assinado digitalmente. Na primeira execução o Windows
> SmartScreen pode pedir confirmação: escolha **Mais informações → Executar
> assim mesmo**.

## 2. Baixar os modelos (primeiro uso)

O instalador inclui os mecanismos de transcrição, mas **não** os modelos de voz.
No primeiro uso:

1. Abra o Local Flow.
2. No painel **Modelos de voz e mecanismo**, clique em **Baixar** no perfil
   desejado:
   - **Small · rápido** (~190 MB): menor latência.
   - **Medium · padrão** (~514 MB): equilíbrio recomendado.
   - **Large V3 Turbo · precisão** (~547 MB): maior qualidade.
   - **Parakeet v3 · veloz e preciso** (~681 MB, Parakeet TDT 0.6B v3): alternativa para ditado em português.
3. Aguarde a barra de progresso concluir. O perfil fica disponível
   imediatamente. Selecione-o em **Configurações → Perfil do modelo**.

O Parakeet serve para o ditado e para reuniões. Nas reuniões o app pede ao
Parakeet o horário de cada palavra, que é o que permite intercalar as falas do
seu microfone com as do áudio do sistema. Escolha o modelo das reuniões em
**Configurações → Reuniões → Qualidade da transcrição**.

Os modelos são baixados de `huggingface.co` e salvos em
`%APPDATA%\Local Flow\models`. Você pode baixar mais de um perfil e alternar
entre eles a qualquer momento.

### Revisão opcional com Ollama

Para os modos **limpo** e **inteligente**, instale o
[Ollama](https://ollama.com) e baixe o modelo padrão:

```powershell
ollama pull qwen2.5:3b
```

O status do Ollama aparece em **Configurações**. Sem o Ollama, o modo
**literal** continua funcionando normalmente.

## 3. Atualizar

Execute o instalador de uma versão mais nova. As configurações e os modelos já
baixados são preservados (ficam na pasta de dados do usuário, fora da pasta de
instalação).

## 4. Desinstalar

1. Abra **Configurações do Windows → Aplicativos → Aplicativos instalados**.
2. Localize **Local Flow** e escolha **Desinstalar**. Também é possível usar o
   atalho *Desinstalar Local Flow* no menu Iniciar.

A desinstalação remove o programa, mas **mantém** seus dados em
`%APPDATA%\Local Flow` (configurações e modelos), para o caso de uma
reinstalação. Para remover tudo, apague essa pasta manualmente:

```powershell
Remove-Item "$env:APPDATA\Local Flow" -Recurse -Force
```

## Solução de problemas

- **"whisper-cli.exe não foi encontrado"**: a instalação está incompleta.
  Reinstale o aplicativo.
- **O download do modelo falha**: verifique a conexão e o espaço em disco e
  clique em **Baixar** novamente. O download é retomável do zero de forma
  segura (um arquivo `.part` temporário é descartado em caso de falha).
- **O atalho global não funciona**: outro aplicativo pode estar usando a mesma
  combinação. Ajuste em **Configurações → Atalho**.
- **A inserção automática não cola**: confirme que **Colar automaticamente**
  está ativo e que o campo de destino aceita `Ctrl+V`.
