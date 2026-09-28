# Local Flow — guia rápido de instalação

O Local Flow transforma sua voz em texto no Windows. A transcrição acontece no
seu computador: não é necessário criar conta e o áudio é removido depois do uso.

## O que você recebeu

- `Local Flow Setup 0.8.0.exe`: instalador do aplicativo.
- Este guia: instruções de instalação e primeira configuração.

## Antes de começar

- Computador com Windows 10 ou Windows 11, 64 bits.
- Internet na primeira configuração, para baixar o modelo de voz.
- Espaço livre para o modelo de voz. A configuração recomendada usa cerca de
  190 MB para o modelo Small. O modo de revisão por IA é opcional e ocupa mais
  espaço no computador.

## 1. Instale o Local Flow

1. Dê dois cliques em `Local Flow Setup 0.8.0.exe`.
2. Siga as telas do instalador.
3. Se o SmartScreen mostrar a mensagem “O Windows protegeu o computador” com a
   opção **Mais informações**, clique nela e depois em **Executar assim mesmo**.
   Se a tela disser **Smart App Control blocked an app** e mostrar somente
   **Okay**, não existe liberação individual: essa versão não deve ser
   distribuída para esse computador. Aguarde a versão assinada ou publicada na
   Microsoft Store; não desative a proteção apenas para instalar o aplicativo.
4. Ao terminar, abra o **Local Flow** pelo menu Iniciar ou pelo atalho da área
   de trabalho.

## 2. Baixe o modelo de voz

1. No Local Flow, abra a aba **Modelos**.
2. Em **Small · rápido**, clique em **Baixar** e espere terminar.
3. Em **Configurações**, escolha o perfil **Rápido · Small**.

Com isso, o ditado já funciona. Clique onde deseja escrever, aperte
**Ctrl + Shift + Espaço**, fale e aperte o mesmo atalho novamente para
transcrever e colar o texto.

## Configuração recomendada por Thiago Marçal

Esta é a configuração usada no dia a dia, pensada para responder rápido e ainda
entregar texto bem pontuado:

- **Perfil de voz:** Rápido · Small.
- **Tratamento do texto:** Limpo.
- **Modelo de revisão:** `qwen2.5:3b` no Ollama.
- **Colar automaticamente:** ligado.
- **Iniciar com o Windows:** opcional; deixe ligado se quiser que o Local Flow
  já fique disponível na bandeja ao ligar o computador.

O modelo Small faz o reconhecimento da fala. O modo **Limpo** usa uma IA local
para melhorar pontuação, capitalização e pequenas hesitações, sem resumir o
conteúdo. Se preferir receber exatamente a transcrição bruta, escolha
**Literal** em vez de Limpo.

## 3. Instale o Ollama (necessário somente para o modo Limpo)

O Ollama é um programa separado que roda a IA de revisão no seu próprio
computador. O Local Flow continua funcionando sem ele; nesse caso, use o modo
Literal.

1. Baixe e instale o Ollama para Windows em <https://ollama.com/download>.
2. Depois de instalar, abra o **PowerShell** pelo menu Iniciar.
3. Cole este comando e aperte Enter:

   ```powershell
   ollama pull qwen2.5:3b
   ```

4. Espere o download terminar. O Ollama pode permanecer aberto em segundo plano.
5. Volte ao Local Flow → **Configurações** → em **Tratamento do texto**, escolha
   **Limpo**. Em **Modelo de revisão**, selecione `qwen2.5:3b`.

Quando o indicador do Ollama aparecer como disponível, a configuração está
pronta.

## Dicas para reconhecer melhor nomes e termos

Em **Configurações → Vocabulário de contexto**, escreva nomes de pessoas,
marcas, siglas e termos técnicos que você fala com frequência, separados por
vírgula. Para um erro que se repete, use **Substituições**, por exemplo:

```text
codecs => Codex
thiago marcial => Thiago Marçal
```

## Atualização e suporte

Para atualizar, instale uma versão mais nova por cima da anterior. Suas
configurações e modelos baixados são preservados.

Em caso de dúvida, envie uma mensagem para: **[adicione aqui seu canal de
suporte]**.
