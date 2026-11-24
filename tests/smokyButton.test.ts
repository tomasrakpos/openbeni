import { describe, expect, it } from "vitest";
import { hexToRgb, resolveSiteSmokeColors } from "@/components/ui/smoky-button";

describe("SmokyButton theme color mapping", () => {
  it("converts 3-digit and 6-digit hex strings to normalized RGB", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#f0a")).toEqual([1, 0, 170 / 255]);
    expect(hexToRgb("invalid")).toEqual([0, 0, 0]);
  });

  it("produces distinct site-matched smoke palettes for all 4 light/dark × violet/ember combinations", () => {
    const darkViolet = resolveSiteSmokeColors(true, "violet");
    const darkEmber = resolveSiteSmokeColors(true, "ember");
    const lightViolet = resolveSiteSmokeColors(false, "violet");
    const lightEmber = resolveSiteSmokeColors(false, "ember");

    // Dark palettes use deep shadow tones; light palettes use soft bright shadows
    expect(hexToRgb(darkViolet.shadow)[0]).toBeLessThan(0.15);
    expect(hexToRgb(darkEmber.shadow)[0]).toBeLessThan(0.15);
    expect(hexToRgb(lightViolet.shadow)[0]).toBeGreaterThan(0.8);
    expect(hexToRgb(lightEmber.shadow)[0]).toBeGreaterThan(0.8);

    // Violet vs ember primaries stay clearly distinct
    expect(darkViolet.primary).not.toBe(darkEmber.primary);
    expect(lightViolet.primary).not.toBe(lightEmber.primary);
  });
});
