import { describe, expect, it } from "vitest";
import { allow, clientIp, resetRateLimit } from "../src/lib/rate-limit.js";

describe("rate-limit helpers", () => {
  it("allows a burst up to the limit and then blocks until the window passes", () => {
    resetRateLimit();
    const start = 1_000;
    expect(allow("a", 2, 100, start)).toBe(true);
    expect(allow("a", 2, 100, start + 10)).toBe(true);
    expect(allow("a", 2, 100, start + 20)).toBe(false);
    expect(allow("a", 2, 100, start + 111)).toBe(true);
  });

  it("reads the first forwarded IP and falls back when the header is missing", () => {
    expect(clientIp({ "x-forwarded-for": " 1.1.1.1, 2.2.2.2" })).toBe("1.1.1.1");
    expect(clientIp({ "x-real-ip": "3.3.3.3" })).toBe("3.3.3.3");
    expect(clientIp({}, "local")).toBe("local");
  });
});
