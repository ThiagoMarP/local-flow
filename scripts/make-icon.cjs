// Gera assets/icon.ico (multi-tamanho) e assets/icon.png a partir de app-icon.png.
// Usa o nativeImage do Electron para redimensionar — sem dependências externas.
// O icon.ico é usado na janela, na barra de tarefas, na bandeja e (futuro) no instalador.
// Uso: electron scripts/make-icon.cjs   (ou: npm run icon)
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "app-icon.png");
const outDir = path.join(root, "assets");
const sizes = [16, 24, 32, 48, 64, 128, 256];

// Monta um arquivo .ico com entradas PNG (suportado pelo Windows Vista+).
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: 1 = ícone
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const blobs = [];
  entries.forEach((item, i) => {
    const e = i * 16;
    dir.writeUInt8(item.size >= 256 ? 0 : item.size, e + 0); // largura (0 = 256)
    dir.writeUInt8(item.size >= 256 ? 0 : item.size, e + 1); // altura (0 = 256)
    dir.writeUInt8(0, e + 2); // nº de cores
    dir.writeUInt8(0, e + 3); // reservado
    dir.writeUInt16LE(1, e + 4); // planos
    dir.writeUInt16LE(32, e + 6); // bits por pixel
    dir.writeUInt32LE(item.buffer.length, e + 8); // tamanho dos dados
    dir.writeUInt32LE(offset, e + 12); // deslocamento dos dados
    offset += item.buffer.length;
    blobs.push(item.buffer);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

app.whenReady().then(() => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const base = nativeImage.createFromPath(src);
    if (base.isEmpty()) throw new Error("Não consegui carregar " + src);

    const entries = sizes.map((size) => ({
      size,
      buffer: base
        .resize({ width: size, height: size, quality: "best" })
        .toPNG(),
    }));

    fs.writeFileSync(path.join(outDir, "icon.ico"), buildIco(entries));
    fs.writeFileSync(
      path.join(outDir, "icon.png"),
      base.resize({ width: 256, height: 256, quality: "best" }).toPNG(),
    );

    console.log("OK ico:", path.join(outDir, "icon.ico"));
    console.log("OK png:", path.join(outDir, "icon.png"));
    console.log("tamanhos:", sizes.join(", "));
  } catch (err) {
    console.error("ERRO:", err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
