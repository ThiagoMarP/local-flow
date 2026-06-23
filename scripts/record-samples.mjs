import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = process.cwd();
const promptsPath = path.join(root, "benchmarks", "prompts.json");
const prompts = JSON.parse(await readFile(promptsPath, "utf8"));
const port = Number(process.env.PORT || 4317);

const page = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Flow — Amostras</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: radial-gradient(circle at 50% 0%, #263252 0, #111522 42%, #090b10 100%);
      color: #f7f8fb;
    }
    main {
      width: min(760px, calc(100% - 32px)); padding: 34px;
      border: 1px solid #ffffff18; border-radius: 28px;
      background: #10141ddd; box-shadow: 0 24px 80px #0009;
      backdrop-filter: blur(24px);
    }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    h1 { font-size: 20px; margin: 0; }
    .counter { color: #aeb7c9; }
    .category { margin: 42px 0 12px; color: #8ea9ff; font-size: 13px; text-transform: uppercase; letter-spacing: .12em; }
    .prompt { min-height: 110px; font-size: clamp(25px, 4vw, 38px); line-height: 1.28; margin: 0; }
    .status { min-height: 28px; color: #aeb7c9; margin: 28px 0; }
    .meter { height: 8px; overflow: hidden; border-radius: 20px; background: #ffffff12; }
    .meter span { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #6b8cff, #9d6bff); transition: width 80ms linear; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
    button {
      border: 0; border-radius: 999px; padding: 13px 20px; font: inherit;
      color: #f7f8fb; background: #252b39; cursor: pointer;
    }
    button.primary { background: #6d72ff; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .note { margin-top: 24px; color: #778196; font-size: 13px; line-height: 1.5; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Gravação do benchmark</h1>
    <span class="counter"></span>
  </header>
  <div class="category"></div>
  <p class="prompt"></p>
  <p class="status">Leia a frase de forma natural, em um ambiente normal de uso.</p>
  <div class="meter"><span></span></div>
  <div class="actions">
    <button class="primary record">Gravar</button>
    <button class="stop" disabled>Parar e baixar WAV</button>
    <button class="next" disabled>Próxima frase</button>
  </div>
  <p class="note">Os arquivos são gerados no navegador e baixados para o seu computador. Depois, mova os dez WAV para <code>benchmarks/samples</code>.</p>
</main>
<script>
const prompts = ${JSON.stringify(prompts)};
let index = 0;
let context;
let source;
let processor;
let stream;
let buffers = [];
let sourceRate = 48000;

const counter = document.querySelector(".counter");
const category = document.querySelector(".category");
const prompt = document.querySelector(".prompt");
const status = document.querySelector(".status");
const meter = document.querySelector(".meter span");
const record = document.querySelector(".record");
const stop = document.querySelector(".stop");
const next = document.querySelector(".next");

function render() {
  const item = prompts[index];
  counter.textContent = (index + 1) + " / " + prompts.length;
  category.textContent = item.category;
  prompt.textContent = item.text;
  next.textContent = index === prompts.length - 1 ? "Concluir" : "Próxima frase";
}

function downsample(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.round(i * ratio);
    const end = Math.min(Math.round((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

record.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    context = new AudioContext();
    sourceRate = context.sampleRate;
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    buffers = [];
    processor.onaudioprocess = (event) => {
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      buffers.push(chunk);
      let peak = 0;
      for (const value of chunk) peak = Math.max(peak, Math.abs(value));
      meter.style.width = Math.min(100, peak * 220) + "%";
    };
    source.connect(processor);
    processor.connect(context.destination);
    record.disabled = true;
    stop.disabled = false;
    next.disabled = true;
    status.textContent = "Gravando…";
  } catch (error) {
    status.textContent = "Não foi possível acessar o microfone: " + error.message;
  }
});

stop.addEventListener("click", async () => {
  processor.disconnect();
  source.disconnect();
  stream.getTracks().forEach((track) => track.stop());
  await context.close();

  const size = buffers.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Float32Array(size);
  let offset = 0;
  for (const chunk of buffers) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const samples = downsample(joined, sourceRate, 16000);
  const blob = encodeWav(samples, 16000);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = prompts[index].id + ".wav";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);

  meter.style.width = "0";
  record.disabled = false;
  stop.disabled = true;
  next.disabled = false;
  status.textContent = "WAV baixado. Você pode repetir ou seguir para a próxima frase.";
});

next.addEventListener("click", () => {
  if (index < prompts.length - 1) {
    index++;
    render();
    next.disabled = true;
    status.textContent = "Leia a frase de forma natural, em um ambiente normal de uso.";
  } else {
    status.textContent = "Concluído. Mova os dez arquivos para benchmarks/samples.";
    record.disabled = true;
    next.disabled = true;
  }
});

render();
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Gravador disponível em http://127.0.0.1:${port}`);
  console.log("Pressione Ctrl+C para encerrar.");
});

