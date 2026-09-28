# Limpeza leve (experimental)

O modo é opcional. `Literal` continua como padrão. O texto original da
transcrição é guardado com o resultado no histórico local dos novos ditados
feitos nesse modo. `Copiar original` permite recuperá-lo; não altera texto já
colado em outro aplicativo. Limpar o histórico remove as duas versões.

## Fluxo

1. Transcrever e aplicar substituições pessoais.
2. Tratar localmente correções explícitas de horário, número, dia ou objeto,
   enumerações e o comando de apagar a
   última frase quando os limites são explícitos.
3. Nos demais casos, pedir uma revisão ao Ollama local. Validar negações,
   palavras de conteúdo, números, URLs, e-mails e termos protegidos. Se a
   resposta falhar, usar a transcrição recebida pela revisão.
4. Expandir snippets depois da revisão e entregar o texto final.

O caminho rápido evita a chamada ao modelo. A validação é deliberadamente
conservadora: uma reescrita válida pode ser descartada. Frases ambíguas devem
ser conferidas pelo usuário. O modo ainda não foi aprovado para uso como padrão.

## Avaliação antes de mudar o padrão

- Reunir ao menos 40 ditados reais em português, com o resultado esperado e
  casos de hesitação, autocorreção, enumeração, negação e afirmações ambíguas.
- Comparar `Literal`, `Limpo` e `Limpeza leve` no mesmo texto transcrito.
- Registrar correções aceitas, falsos positivos, fallback, primeira revisão,
  tempo com modelo aquecido e tempo total até a inserção.
- Exigir nenhum fato ou negação removido nos casos avaliados; revisar
  manualmente todos os resultados antes de considerar o modo padrão.

`npm run benchmark:light` mede casos sintéticos na etapa de revisão. Ele não
mede transcrição, interface, colagem nem a qualidade de ditados reais.
