# Local Flow — Guia de instalação

Local Flow é um app de **ditado** e **transcrição de reunião** que roda **100% no seu
computador** (Windows). Você fala e ele transcreve; em reuniões, ele grava a sua voz
e o áudio do PC (a chamada), separa quem falou e ainda gera uma **ata** com resumo,
tópicos e tarefas.

> Nada é enviado para a internet no uso do dia a dia. Os modelos de IA são baixados
> uma única vez (na instalação) e depois tudo funciona **offline**.

---

## Requisitos
- **Windows 10 ou 11** (não roda em Mac/Linux).
- Internet **apenas na primeira execução** (pra baixar o modelo de voz).

## 1) Instalação (o essencial — ditado + transcrição de reunião)

1. Execute o instalador **`Local Flow Setup ... .exe`** recebido.
2. O Windows pode mostrar *"O Windows protegeu seu PC / editor desconhecido"*.
   Isso é normal (o app não tem certificado pago). Clique em
   **"Mais informações" → "Executar assim mesmo"**.
3. Siga o instalador. Na **primeira vez que abrir**, acesse **Modelos de voz e
   mecanismo** e clique em **Baixar** no modelo desejado (precisa de internet).
   Depois disso, funciona sem internet.

Pronto — o **ditado** e a **transcrição de reunião** já funcionam.

## 2) Resumo por IA / ata (opcional)

O resumo automático das reuniões (e os modos "limpo/inteligente" do ditado) usam um
modelo de IA de texto que roda local, o **Ollama** — que é um programa separado.

1. Instale o **Ollama**: https://ollama.com
2. Abra o terminal (PowerShell) e rode:
   ```
   ollama pull qwen2.5:3b
   ```

**Sem o Ollama nada quebra:** o ditado funciona no modo "literal" (texto cru) e as
reuniões continuam **transcrevendo e separando as falas** — só não geram a ata.

---

## Como usar

- **Ditado:** use o atalho mostrado na página **Início** para gravar e finalizar;
  a transcrição é enviada ao campo onde você estava digitando. No painel, use
  **Cancelar ditado (Esc)** se não quiser transcrever o áudio atual. Você também
  pode pressionar **Esc** enquanto grava ou transcreve para cancelar antes da
  colagem. A bolinha flutuante acompanha o monitor onde está o cursor durante
  o ditado.
- **Reunião:** aperte **Ctrl + Alt + R** para começar a gravar (sua voz + o áudio do
  PC); aperte de novo para parar. Também há botões **Iniciar gravação** e
  **Parar reunião** na aba **Reuniões**. A transcrição aparece ali depois do
  processamento; a ata depende do Ollama local.
- O áudio e a transcrição das reuniões ficam salvos **somente neste computador**,
  na aba **Reuniões**, até você excluir a reunião. O áudio do ditado é temporário.
- Os atalhos, a qualidade e os modelos podem ser trocados em **Configurações**.
- Para experimentar o **Parakeet TDT 0.6B v3** no ditado, baixe-o em **Modelos de
  voz e mecanismo** e escolha-o em **Configurações → Perfil do modelo**. As
  reuniões continuam com os modelos Whisper.

## Privacidade
Toda a transcrição e o resumo acontecem no seu computador. Os únicos downloads são os
modelos de IA (uma vez), do huggingface.co (voz) e do Ollama (texto).
