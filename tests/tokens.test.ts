// Tests for tokens.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import {
  dateBucket,
  deriveTitle,
  detectDirection,
  estimateMessages,
  estimateTokens,
  formatPricing,
  formatTokens,
  usageRatio,
} from "@/lib/tokens";

describe("estimateTokens", () => {
  it("returns zero for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("grows with content and stays deterministic for RTL text", () => {
    expect(estimateTokens("hello world")).toBeGreaterThanOrEqual(2);
    const first = estimateTokens("سلام دنیا");
    const second = estimateTokens("سلام دنیا");
    const third = estimateTokens("سلام دنیا");
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toBeGreaterThan(1);
  });

  it("counts CJK by characters", () => {
    expect(estimateTokens("你好世界")).toBeGreaterThanOrEqual(4);
  });

  it("adds message overhead in estimateMessages", () => {
    expect(estimateMessages([])).toBe(0);
    expect(estimateMessages([{ content: "hi" }])).toBeGreaterThan(estimateTokens("hi"));
  });
});

describe("usageRatio", () => {
  it("clamps to 1 and handles missing windows", () => {
    expect(usageRatio(50, 100)).toBe(0.5);
    expect(usageRatio(500, 100)).toBe(1);
    expect(usageRatio(50, undefined)).toBe(0);
    expect(usageRatio(50, 0)).toBe(0);
  });
});

describe("formatTokens", () => {
  it("formats thousands and millions", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("formatPricing", () => {
  it("shows a dash without pricing and digits with pricing", () => {
    expect(formatPricing()).toBe("—");
    expect(formatPricing({ prompt: 0, completion: 0 })).toBe("$0 / $0 per 1M");
    expect(formatPricing({ prompt: 1.25, completion: 10 })).toBe("$1.25 / $10.00 per 1M");
  });
});

describe("deriveTitle", () => {
  it("strips markdown and fenced code", () => {
    const title = deriveTitle("```js\nconst x = 1\n```\n**Hello** world");
    expect(title).toContain("Hello world");
    expect(title).not.toContain("`");
    expect(title).not.toContain("*");
  });

  it("truncates long titles", () => {
    const title = deriveTitle("a".repeat(120), 20);
    expect(title.length).toBeLessThanOrEqual(21);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back for empty input", () => {
    expect(deriveTitle("   ")).toBe("New chat");
  });
});

describe("detectDirection", () => {
  it("detects Persian and Latin text", () => {
    expect(detectDirection("سلام دنیا")).toBe("rtl");
    expect(detectDirection("hello world")).toBe("ltr");
  });
});

describe("dateBucket", () => {
  it("buckets timestamps relative to now", () => {
    const now = Date.now();
    expect(dateBucket(now)).toBe("today");
    expect(dateBucket(now - 3 * 86_400_000)).toBe("week");
    expect(dateBucket(new Date(new Date().getFullYear() - 1, 0, 1).getTime())).toBe("older");
  });
});
