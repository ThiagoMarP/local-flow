# Roadmap de Melhorias — Local Flow

Documento vivo com as melhorias e ajustes acordados. Atualizado em 30/06/2026.

## Como vamos trabalhar (loop de build/teste)

Pra não cair de novo no ciclo manual doloroso de fechar app → buildar → reinstalar:

- **`npm start`** — iteração rápida de UI/código (código vivo, sem build). Usar sempre que dá.
- **`npm run deploy`** *(novo)* — um comando só: encerra o app, builda o instalador numa pasta limpa, instala por cima (silencioso) e reabre. Resolve a dor repetitiva.
- **Auto-update real (a decidir)** — o app se atualizar sozinho. Precisa de um host de releases (ex.: GitHub Releases). Em avaliação — ver item 0.

> Nota recorrente: bugs que **só aparecem no `.exe`** (não no `npm start`) já nos morderam — ver `memory`/`packaged-build-gotchas`. Por isso o item de **teste de fumaça do build** segue na lista.

---

## Prioridades / Estado

| Status | Item |
|---|---|
| ✅ | Bug do clipboard (penúltimo) — `restoreClipboard` off por padrão |
| ✅ | Cápsula de áudio no **topo** da tela |
| ✅ | Aba de **histórico** + busca + agrupamento por dia |
| ✅ | **Redesign sidebar + páginas** (estilo Superwhisper): Início / Histórico / Configurações / Modelos |
| ✅ | Cápsula vira **linha fina** no repouso (mesmo preto/contorno do pill) e **cresce** ao gravar |
| ✅ | **Transparência acrylic** (Win11) + cores **pretas neutras** (tirado o azul) |
| ✅ | **Pré-checagem "nada falado"** (pula transcrição no silêncio, resposta instantânea) |
| ✅ | Sensibilidade do áudio (curva perceptual) + alucinações `[MÚSICA]` (`-sns` + strip) |
| ✅ | **Cápsula — fluxo de animação** (sem flash; loading L→R; **pulso de conclusão**) + tons do dashboard unificados à sidebar |
| ⏸️ | **Auto-update / instalar no app** — travado pelo **Smart App Control** (desligar SAC vs assinar) |
| ⏸️ | **Parakeet** (velocidade) — travado: binário antigo incompatível com modelo novo + SAC bloqueia binário novo |
| ⏸️ | **Servidor quente** (`whisper-server`) — **adiado por decisão (30/06/2026):** usuário prioriza economia de RAM e usa só o Small, que já responde rápido. O ganho do hot-server é em modelo grande + recarga repetida, que não é o caso. Reavaliar se migrar pra medium/large no dia a dia. |

> Estamos desenvolvendo via **`npm start`** (funciona sob o SAC); o `npm run deploy` e o auto-update ficam pra quando decidirmos o SAC.

---

## ✅ FEITO: Cápsula — fluxo de animação

Implementado e validado (30/06/2026) em [capsule.css](src/renderer/capsule.css), [capsule.html](src/renderer/capsule.html), [capsule.js](src/renderer/capsule.js), [main.cjs](src/main/main.cjs) e [window-manager.cjs](src/main/services/window-manager.cjs):

1. **Sem "flash de luz":** o `onStart` do atalho vai direto pro `recording`, e o renderer mapeia `requesting → recording` — a transição **linha (idle) → onda** é direta, sem spinner no meio.
2. **Loading L→R:** o `processing` mantém as barras e o tamanho do card; elas viram um **sweep da esquerda → direita** (`@keyframes sweep` + delays escalonados), em vez do spinner.
3. **Pulso de conclusão (no lugar do check):** o `success` é **o mesmo pill, mesmo tamanho** da gravação/loading — as barras dão **um único batimento em uníssono** (`@keyframes beat`) e o pill **fecha** pra linha (fechamento delegado ao `idle`; auto-hide do success em 700ms). Sem ícone.
   - ⚠️ Gotcha de CSS: `width` de `fit-content` → valor fixo **não transiciona** no Chromium (salta na hora, ignora o delay). Por isso o `success` **não mexe em width/padding** — só pulsa; quem colapsa pra linha é o `idle`.

**Transição final:** linha fina → onda gravando → onda de loading L→R → **pulso** → fecha na linha.

**Bônus:** tons dos cards do dashboard ([styles.css](src/renderer/styles.css)) unificados ao tom da sidebar (`rgba(11,11,13,0.55)` ≈ `rgba(9,9,11,0.5)`).

---

## 0. Sistema de atualização

**Dor:** toda mudança de código exige fechar app → `npm run dist` → matar processo → reinstalar → lidar com locks do Defender/Explorer.

**Solução em duas camadas:**
- **`npm run deploy`** (feito): automatiza tudo localmente, em um comando. Builda numa pasta nova (`dist/builds/<timestamp>`) pra fugir dos locks, instala silencioso e reabre. É o que usamos no nosso ciclo.
- **Auto-update (electron-updater):** o app verifica e baixa novas versões sozinho. Precisa de um lugar pra publicar as releases. Opções:
  - **GitHub Releases** — padrão, grátis. Exige um repositório GitHub (pode ser privado) + token. Eu configuro tudo; você cria o repo/token.
  - **Só o deploy local** — não precisa de host; suficiente se sou eu/você quem builda após cada sessão.
- **Decisão pendente:** qual caminho de auto-update seguir (ver pergunta no chat).

**⚠️ Bloqueador descoberto — Smart App Control (SAC):** o Windows 11 desta máquina está com o SAC **ligado (enforced)**, que **bloqueia instalar/executar binários não-assinados**. O `npm run deploy` builda ok, mas a instalação do `.exe` local é barrada. Implicações:
- `npm start` **funciona** sob o SAC (roda o `electron.exe`, que é assinado) → é o loop de dev/teste das features.
- Pôr a versão final no **app instalado** (e qualquer auto-update via instalador) exige: **(a) desligar o SAC** (irreversível sem resetar o Windows) **ou (b) assinar o app** com certificado confiável (EV p/ confiança imediata; custa). Decisão a tomar quando as features estiverem prontas.
- `electron-updater` fica **em espera** até resolver o SAC (o update também instala um `.exe`, então seria barrado igual).

---

## 1. Bug do clipboard — texto fica no "penúltimo" (🔴 fix rápido)

**Sintoma:** depois de transcrever, o texto **não** fica direto no Ctrl+V; no histórico do Windows (Win+V) ele aparece como **penúltimo**, e o item antigo fica como o atual.

**Causa raiz (já localizada):** o ajuste **"Restaurar texto do clipboard"** (`restoreClipboard`, ligado nas suas configs). O fluxo em [clipboard-service.cjs](src/main/services/clipboard-service.cjs) é:
1. escreve a transcrição no clipboard (vira o item atual),
2. cola com Ctrl+V no app de destino,
3. depois de ~450ms, **restaura o clipboard antigo por cima** → empurra a transcrição pro penúltimo lugar.

**Fix proposto:** deixar a transcrição como o item **atual** do clipboard (não restaurar por cima), tornando o "Restaurar clipboard" desligado por padrão (ou repensar a lógica). Combina bem com a aba de histórico (item 3) pra recopiar quando quiser.

---

## 2. Cápsula de áudio no topo da tela (🟡)

**Pedido:** mover a cápsula de gravação pra **parte de cima** da tela, mantendo o mesmo espaçamento que ela tem hoje em relação à borda (sem colar no topo).

**Onde mexer:** [window-layout.cjs](src/main/window-layout.cjs) (`calculateCapsuleBounds` posiciona a partir da base — passar a posicionar a partir do topo) + ajuste do alinhamento/sombra em [capsule.css](src/renderer/capsule.css) (hoje o pill é ancorado em cima com folga de sombra embaixo; no topo, inverter a folga).

---

## 3. Aba de histórico de transcrições (🟡)

**Pedido:** uma aba/seção no painel com o **histórico das transcrições** (clicar pra copiar, como o card "Última mensagem").

**Base já existe:** [transcription-history.cjs](src/main/services/transcription-history.cjs) hoje guarda só a **última**. Estender pra guardar uma **lista** (com data/hora, texto, talvez perfil usado). Definir:
- quantos itens guardar (ex.: últimos 100) e/ou opção de limpar;
- privacidade: fica só local (userData), nunca sai do PC — coerente com o app;
- UI: lista com clique-pra-copiar + busca simples (opcional).

---

## 4. Avaliar Parakeet (NVIDIA) vs Whisper (🟢 pesquisa feita)

**Contexto:** o Superwhisper usa o Parakeet localmente e é muito mais rápido. Você já tem `parakeet-cli.exe`/`parakeet.dll` no projeto.

**Pesquisa (resumo):**
- ✅ **Velocidade:** Parakeet TDT 0.6B v3 é ~**5–10x mais rápido** que o Whisper large-v3-turbo.
- ✅ **Português:** a **v3** (set/2025) suporta 25 idiomas europeus, **incluindo português** (as versões antigas eram só inglês).
- ✅ **Precisão (inglês):** WER ~6.3% vs ~7.4% do Whisper; na média multilíngue empata com o Whisper Large.
- ⚠️ **Risco pt-BR:** treinado em **português europeu**, não brasileiro → pode variar no seu sotaque/gírias.
- ⚠️ **Prático:** confirmar formato de modelo que o `parakeet-cli.exe` aceita e achar um modelo compatível; medir velocidade **na sua CPU** (os 10x costumam ser citados em GPU/Apple Silicon).

**Recomendação:** **testar lado a lado** (mesmos áudios seus): velocidade + precisão pt-BR Parakeet vs Whisper atual. Se o pt-BR ficar bom, trocar/ adicionar como perfil. Não substituir às cegas.

**Caminho técnico (confirmado):**
- O `native/whisper/parakeet-cli.exe` é do projeto **CrispASR** (runtime ggml, mesmo backend do whisper-cli). Usa CPU normalmente (`-ng` desliga GPU).
- CLI: `parakeet-cli.exe -m <modelo.gguf> -f <audio.wav> -otxt -np -t <threads>` (aceita wav/mp3; saída em txt/stdout; sem flag de idioma — é multilíngue/auto).
- **Modelo (falta baixar):** `cstr/parakeet-tdt-0.6b-v3-GGUF` no HuggingFace (~467 MB no quant q4_k; há quants maiores p/ mais precisão). Ex.: `https://huggingface.co/cstr/parakeet-tdt-0.6b-v3-GGUF/resolve/main/parakeet-tdt-0.6b-v3-q4_k.gguf`.

**Plano de teste:** baixar o modelo → rodar parakeet-cli nos seus áudios de amostra → comparar **tempo** e **qualidade do texto pt-BR** vs Whisper atual → decidir (adicionar como perfil novo, ou trocar). Integração: novo "engine" no pipeline ([transcription-pipeline.cjs](src/main/services/transcription-pipeline.cjs) / [whisper-service.cjs](src/main/whisper-service.cjs)) parseando a saída do parakeet-cli.

**Fontes:** [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [cstr/parakeet-tdt-0.6b-v3-GGUF](https://huggingface.co/cstr/parakeet-tdt-0.6b-v3-GGUF), [CrispASR](https://github.com/CrispStrobe/CrispASR), [Parakeet vs Whisper 2026](https://localaimaster.com/blog/parakeet-vs-whisper).

---

## 5. Performance geral (🟢)

- ✅ **Threads dinâmicas** ([main.cjs](src/main/main.cjs) passa `os.cpus().length`; [whisper-service.cjs](src/main/whisper-service.cjs) faz `Math.min(threads, os.cpus().length)`). Evita oversubscription em máquinas com poucos cores. *(Nesta máquina, 24 cores → segue 24; o ganho é em máquinas menores.)*
- ✅ **AudioWorklet** no lugar do `ScriptProcessorNode` deprecado — captura na thread de áudio ([capture-worklet.js](src/renderer/capture-worklet.js) + [renderer.js](src/renderer/renderer.js)). Validado pelo `npm run test:mic` (chunks/wavBytes ok).
- Possível ganho grande vem do item 4 (Parakeet), se passar no teste pt-BR.

---

## Backlog técnico (das sugestões anteriores)

- ✅ **Teste de fumaça do build empacotado** — `npm run smoke:packaged` ([scripts/electron-packaged-smoke.mjs](scripts/electron-packaged-smoke.mjs)): empacota (`--dir`) e valida o layout (binários nativos como extraResources, helpers `.ps1`, conteúdo do asar incl. ícone da bandeja e o `capture-worklet.js`). Com `--run` dá boot no `.exe` e exige `LOCAL_FLOW_SETUP_OK` (`packaged=true`, `whisperAvailable=true`). *Observação (30/06/2026): nesta máquina o `.exe` recém-buildado **bootou sob o SAC** (boot OK) — o bloqueio do SAC parece ser do **instalador NSIS**, não do exe direto. Reavaliar antes de assumir que precisa assinar.*
- Assinatura de código (reduz atrito com Defender/SmartScreen).
- Resampling com anti-aliasing ([audio.js](src/renderer/audio.js)).
- Logar mensagem de erro p/ erros não-sensíveis ([privacy-logger.cjs](src/main/services/privacy-logger.cjs)).
