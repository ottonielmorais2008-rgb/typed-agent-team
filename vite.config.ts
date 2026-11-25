import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { handleRunHttp } from "./src/lib/api.js";
import type { HttpRequest, HttpResponse } from "./src/lib/http.js";

async function readBody(req: IncomingMessage, max = 16_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    chunks.push(buf);
    if (size > max) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function headersOf(req: IncomingMessage): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key] = value;
  return headers;
}

function wrapResponse(res: ServerResponse): HttpResponse {
  const wrapper: HttpResponse = {
    status(code: number) {
      res.statusCode = code;
      return wrapper;
    },
    json(body: unknown) {
      if (!res.getHeader("Content-Type")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      if (body == null && res.statusCode === 204) {
        res.end();
        return;
      }
      res.end(JSON.stringify(body));
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
    },
  };
  return wrapper;
}

function apiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url !== "/api/run") {
          next();
          return;
        }
        const raw = req.method === "POST" ? await readBody(req) : "";
        const httpReq: HttpRequest = {
          method: req.method,
          headers: headersOf(req),
          body: raw ? raw : undefined,
          socket: { remoteAddress: req.socket.remoteAddress },
        };
        const httpRes = wrapResponse(res);
        await handleRunHttp(httpReq, httpRes);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null && typeof value === "string") process.env[key] = value;
  }
  return {
    plugins: [react(), apiPlugin()],
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
    },
  };
});
