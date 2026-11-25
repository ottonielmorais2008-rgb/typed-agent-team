import type { HttpRequest, HttpResponse } from "../src/lib/http.js";

export class FakeResponse implements HttpResponse {
  statusCode = 200;
  body: unknown = undefined;
  headers: Record<string, string> = {};

  status(code: number): HttpResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): void {
    this.body = body;
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }
}

export function post(body: unknown, extra: Partial<HttpRequest> = {}): HttpRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)) },
    body: raw,
    socket: { remoteAddress: "127.0.0.1" },
    ...extra,
  };
}

export function queueClient(replies: Array<string | Error>) {
  const remaining = [...replies];
  return {
    async complete(): Promise<string> {
      const next = remaining.shift();
      if (next == null) throw new Error("The mock client had no reply left.");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
