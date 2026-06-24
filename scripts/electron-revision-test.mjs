import { createServer } from "node:http";
import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/api/tags") {
    response.end(
      JSON.stringify({
        models: [
          { name: "qwen2.5:3b" },
          { name: "qwen2.5:7b" },
        ],
      }),
    );
    return;
  }
  if (request.url === "/api/generate" && request.method === "POST") {
    request.resume();
    request.on("end", () => {
      response.end(
        JSON.stringify({
          response: JSON.stringify({
            text: "Vamos revisar o contrato, atualizar a proposta e agendar a apresentação.",
          }),
        }),
      );
    });
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not-found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const sample = path.join(
  process.cwd(),
  "benchmarks",
  "samples",
  "05-lista.wav",
);

try {
  const output = await runElectron({
    electronArgs: [
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--in-process-gpu",
    ],
    env: {
      LOCAL_FLOW_REVISION_TEST_AUDIO: sample,
      LOCAL_FLOW_E2E_REVISION_MODE: "smart",
      LOCAL_FLOW_E2E_REVISION_MODEL: "qwen2.5:3b",
      LOCAL_FLOW_REVISION_ENDPOINT:
        `http://127.0.0.1:${address.port}`,
    },
    expectedOutput: [
      "LOCAL_FLOW_REVISION_OK=",
      '"applied":true',
      '"fallback":false',
    ],
    timeoutMs: 60000,
  });
  console.log(
    output.match(/LOCAL_FLOW_REVISION_OK=.*$/m)?.[0] || output,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
