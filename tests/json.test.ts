import { describe, expect, it } from "vitest";
import { parseJsonPayload } from "../src/lib/json.js";

describe("parseJsonPayload", () => {
  it("reads a raw object and an object wrapped in a markdown fence", () => {
    expect(parseJsonPayload('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonPayload('Sure.\n```json\n{"ok": true}\n```\n')).toEqual({ ok: true });
  });

  it("ignores leading prose and keeps only the outer object", () => {
    expect(parseJsonPayload('here you go {"a":1,"b":{"c":2}} thanks')).toEqual({ a: 1, b: { c: 2 } });
  });

  it("throws on empty, non-object or broken JSON", () => {
    expect(() => parseJsonPayload("")).toThrow(/empty/i);
    expect(() => parseJsonPayload("[]")).toThrow(/json object/i);
    expect(() => parseJsonPayload("{nope}")).toThrow(/valid JSON/i);
  });
});
