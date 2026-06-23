# Fase 1 — Benchmark local

## Estado

Concluída em 2026-06-23.

O `whisper.cpp` 1.9.1 e os modelos `small-q5_1`, `medium-q5_0` e `large-v3-turbo-q5_0` foram instalados e testados no Ryzen AI 9 HX 370.

## Resultado com dez amostras reais

Execução em CPU, 12 threads:

| Modelo | WER bruto | Tempo médio | Fator de tempo real | Leitura |
|---|---:|---:|---:|---|
| small-q5_1 | 38,9% | 2,03 s | 0,30x | Muito rápido, mas perde palavras técnicas |
| medium-q5_0 | 30,3% | 5,89 s | 0,87x | Melhor equilíbrio |
| large-v3-turbo-q5_0 | 25,5% | 7,84 s | 1,16x | Melhor precisão, porém lento na CPU |

O WER bruto superestima alguns erros. Formatações semanticamente corretas, como “R$ 2.450,00” no lugar de “dois mil quatrocentos e cinquenta reais” e “23 de junho de 2026” no lugar dos números por extenso, são contadas como divergências.

### Exemplo técnico

Frase-alvo:

> Crie uma função assíncrona que valide o token antes de chamar a API.

- Small: perdeu grande parte da frase e confundiu `token`.
- Medium: preservou `token` e `API`, mas errou `função assíncrona`.
- Large V3 Turbo: produziu “Cria uma função assíncrona que valide o token antes de chamar a API.”

### Vocabulário personalizado

Sem contexto, os modelos confundiram `Ollama`. Ao enviar os termos técnicos como prompt inicial, os três passaram a produzir corretamente:

> Electron, TypeScript, Whisper, Ollama.

Isso valida o uso futuro do dicionário pessoal como mecanismo de contexto do Whisper.

### Threads

Teste focado do Medium:

| Threads | Tempo aproximado por amostra |
|---:|---:|
| 8 | 7,1 s |
| 12 | 5,6 s |
| 16 | 5,7 s |
| 24 | 5,3 s |

Usaremos até 24 threads inicialmente, com configuração ajustável posteriormente.

## Decisão

- **Perfil rápido:** `small-q5_1`.
- **Perfil padrão:** `medium-q5_0`.
- **Perfil precisão:** `large-v3-turbo-q5_0`.
- **Backend inicial:** CPU.
- **Vocabulário:** prompt inicial montado pelo dicionário pessoal.
- **Vulkan:** adiado até existir um MVP funcional. Ele não bloqueará a Fase 2.

## Próxima fase

Construir o núcleo:

```text
microfone → WAV 16 kHz → Whisper → texto → clipboard
```
