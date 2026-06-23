# Fase 1 — Benchmark local

## Estado

Em andamento.

O `whisper.cpp` 1.9.1 e os modelos `small-q5_1` e `medium-q5_0` já estão instalados localmente. O teste de sanidade confirmou que os dois modelos executam no Ryzen AI 9 HX 370.

## Resultado preliminar

Áudio sintético de 5,8 segundos, 12 threads:

| Modelo | Tempo total aproximado | Observação |
|---|---:|---|
| small-q5_1 | 2,3 s | Mais rápido |
| medium-q5_0 | 5,9 s | Transcrição preliminar mais coerente |

Esse áudio foi produzido pela voz sintética disponível no Windows, que pronunciou português com qualidade inadequada. Portanto, ele valida apenas instalação, execução e desempenho básico. Não deve ser usado para escolher o modelo final.

## Próxima ação

Gravar as dez frases reais:

```powershell
npm.cmd run record:samples
```

Depois:

1. Abrir `http://127.0.0.1:4317`.
2. Permitir acesso ao microfone.
3. Gravar e baixar as dez frases.
4. Mover os arquivos `.wav` para `benchmarks/samples/`.
5. Encerrar o servidor com `Ctrl+C`.

Validar:

```powershell
npm.cmd run phase1:check
```

Executar o benchmark:

```powershell
npm.cmd run benchmark
```

Para testar apenas um modelo:

```powershell
npm.cmd run benchmark -- small
npm.cmd run benchmark -- medium
```

O relatório será criado em `benchmarks/results/`.

## Decisão pendente

Depois dos resultados reais:

- escolher modelo rápido;
- escolher modelo padrão;
- decidir se vale baixar e testar `large-v3-turbo-q5_0`;
- medir 8, 12 e 16 threads;
- decidir se o ganho potencial do Vulkan justifica instalar CMake e compilar outro backend.

