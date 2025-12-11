import http from "node:http";
import { spawn } from "node:child_process";

type Json = any;

export function startHttpBridge(options?: {
  port?: number;
  command?: string;
  args?: string[];
}): void {
  const port = options?.port ?? 3000;
  const command = options?.command ?? process.execPath;
  const args = options?.args ?? ["dist/index.js"];

  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
  });

  child.on("exit", (code, signal) => {
    // eslint-disable-next-line no-console
    console.error(
      `MCP child process exited with code=${code} signal=${signal ?? ""}`,
    );
  });

  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Only POST supported");
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let json: Json;
      try {
        json = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end("Invalid JSON body");
        return;
      }

      const payload = JSON.stringify(json);
      const message =
        `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;

      child.stdin.write(message, (err) => {
        if (err) {
          res.statusCode = 500;
          res.end("Failed to write to MCP child");
        }
      });

      const onData = (data: Buffer) => {
        const text = data.toString("utf8");
        const parts = text.split("\r\n\r\n");
        const bodyPart = parts[1] ?? "";
        res.setHeader("Content-Type", "application/json");
        res.end(bodyPart);
        child.stdout.off("data", onData);
      };

      child.stdout.on("data", onData);
    });
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`HTTP MCP bridge listening on http://localhost:${port}`);
  });
}
