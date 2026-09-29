# Local Flow — resumo da Fase 7

Fase concluída em 24 de junho de 2026.

## Personalizações disponíveis

- Dicionário pessoal para termos enviados ao Whisper.
- Substituições no formato `origem => destino`.
- Snippets no formato `gatilho => conteúdo`.
- Quebras de linha em snippets usando `\n`.
- Perfis neutro, conciso, profissional e casual.

## Ordem segura

1. O Whisper produz a transcrição.
2. Substituições corrigem termos recorrentes.
3. O Ollama revisa o texto, quando habilitado.
4. Snippets são inseridos exatamente como cadastrados.
5. O resultado segue para clipboard ou aplicativo ativo.

O conteúdo dos snippets nunca é enviado ao Ollama.

## Desempenho

Com o limite completo de 100 substituições e 50 snippets, o custo médio
foi de aproximadamente 0,18 ms por ditado.

## Validação

- 46 testes unitários.
- Persistência e migração das configurações.
- Teste Electron com substituição e snippet multilinha.
- Perfil profissional confirmado no prompt do Ollama simulado.
- Pipelines reais Whisper e Ollama.
- Atalho, inserção, clipboard, bandeja e microfone.
- Verificadores das fases 1 a 7.

O próximo marco é a Fase 8: instalador Windows, assistente de modelos,
documentação e testes de instalação/desinstalação.
