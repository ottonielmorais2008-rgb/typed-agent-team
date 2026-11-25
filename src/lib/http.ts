export interface HttpRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}

export const MAX_BODY_BYTES = 8_192;

export function methodOf(req: HttpRequest): string {
  return (req.method ?? "GET").toUpperCase();
}

export function header(req: HttpRequest, name: string): string | undefined {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function tooLarge(req: HttpRequest, max = MAX_BODY_BYTES): boolean {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}

export function readJsonBody(req: HttpRequest): { ok: true; value: unknown } | { ok: false; error: string } {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}

export function cors(res: HttpResponse): void {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}
