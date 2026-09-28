# Local Flow — teste local do pacote MSIX

Este pacote existe para validar a futura distribuição pela Microsoft Store. Ele
é assinado com um certificado criado localmente no computador do desenvolvedor.
Não envie este ZIP ao público e não publique o arquivo `LocalFlow-Dev.cer`.

## Instalação

1. Extraia todo o conteúdo do ZIP para uma pasta.
2. Clique com o botão direito em `INSTALAR-TESTE.ps1` e escolha **Executar com
   PowerShell**.
3. O Windows pedirá confirmação de administrador para confiar no certificado
   de desenvolvimento. Confirme somente porque este pacote foi gerado
   localmente por você.
4. O painel do Local Flow será aberto automaticamente ao terminar.
5. Na aba **Modelos**, indicada por `!` na primeira execução, baixe
   **Small · rápido**.
6. Em **Configurações**, escolha **Rápido · Small** e teste primeiro com
   **Tratamento do texto: Literal**.

Para usar a configuração de Thiago Marçal, instale o Ollama, execute
`ollama pull qwen2.5:3b` e depois escolha **Tratamento do texto: Limpo**.

## O que validar

- O aplicativo abre pelo menu Iniciar.
- O microfone aparece nas configurações.
- O modelo Small baixa normalmente.
- `Ctrl + Shift + Espaço` inicia e encerra o ditado.
- A cápsula permanece visível e o texto é colado no aplicativo ativo.
- O modo Limpo reconhece o Ollama local.
- Fechar o painel mantém o ícone na bandeja.
- Desinstalar pelo Windows remove o aplicativo.

## Remoção completa do teste

Clique com o botão direito em `REMOVER-TESTE.ps1` e escolha **Executar com
PowerShell**. Confirme a solicitação administrativa. O script remove o pacote e
também o certificado de teste da área `Pessoas Confiáveis` do computador.

Os modelos e configurações ficam em `%APPDATA%\local-flow`. Essa pasta não é
apagada automaticamente para evitar perda de histórico. Exclua-a somente se
quiser simular uma primeira instalação totalmente limpa.

## Importante para a publicação

O certificado incluído aqui é apropriado apenas para desenvolvimento. A versão
pública será enviada como MSIX ao Partner Center e assinada pela Microsoft após
a certificação. O campo `Publisher` do manifesto também será substituído pela
identidade fornecida pela Store.
