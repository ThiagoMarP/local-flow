# Local Flow — Resultado da Fase 1

Data: 23 de junho de 2026

## Objetivo validado

O reconhecimento de voz funciona localmente no computador-alvo usando `whisper.cpp`, sem API e sem limite de palavras.

Ambiente:

- AMD Ryzen AI 9 HX 370;
- 24 threads lógicas;
- aproximadamente 32 GB de RAM;
- execução inicial em CPU;
- dez amostras reais em português.

## Comparação

| Perfil | Modelo | Tempo médio | Fator de tempo real | Resultado |
|---|---|---:|---:|---|
| Rápido | small-q5_1 | 2,03 s | 0,30x | Bom para frases simples; fraco em código |
| Padrão | medium-q5_0 | 5,89 s | 0,87x | Melhor equilíbrio |
| Precisão | large-v3-turbo-q5_0 | 7,84 s | 1,16x | Melhor texto; mais lento |

O fator de tempo real abaixo de `1,0x` significa que o processamento leva menos tempo que a duração do áudio.

## Decisões

- O `medium-q5_0` será o padrão inicial.
- O `small-q5_1` será uma opção rápida.
- O `large-v3-turbo-q5_0` será uma opção de precisão.
- A primeira versão usará CPU com até 24 threads.
- Vulkan será uma otimização posterior.
- O dicionário pessoal será enviado ao Whisper como contexto.

## Vocabulário personalizado

Sem contexto, os modelos confundiram o nome `Ollama`. Com um prompt contendo os termos técnicos, os três modelos reconheceram corretamente:

> Electron, TypeScript, Whisper, Ollama.

## Arquitetura de uso final

O navegador foi usado apenas para gravar amostras do benchmark. O aplicativo final seguirá este fluxo:

```text
atalho global
→ captura local do microfone
→ transcrição pelo Whisper local
→ revisão opcional pelo Ollama
→ inserção no aplicativo anteriormente ativo
```

## Próxima fase

Construir o núcleo funcional:

```text
microfone → WAV 16 kHz → Whisper → texto → clipboard
```
