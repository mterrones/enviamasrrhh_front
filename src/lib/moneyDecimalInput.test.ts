import { describe, expect, it } from "vitest";
import { normalizeMoneyDecimalInput, normalizeRatioDecimalInput } from "./moneyDecimalInput";

describe("normalizeMoneyDecimalInput", () => {
  it("strips leading zeros on integer part", () => {
    expect(normalizeMoneyDecimalInput("01")).toBe("1");
    expect(normalizeMoneyDecimalInput("002")).toBe("2");
    expect(normalizeMoneyDecimalInput("0005")).toBe("5");
    expect(normalizeMoneyDecimalInput("0032442.238491293")).toBe("32442.23");
  });

  it("allows zero and fractional forms below one", () => {
    expect(normalizeMoneyDecimalInput("0")).toBe("0");
    expect(normalizeMoneyDecimalInput("0.5")).toBe("0.5");
    expect(normalizeMoneyDecimalInput("0.25")).toBe("0.25");
    expect(normalizeMoneyDecimalInput("0.01")).toBe("0.01");
    expect(normalizeMoneyDecimalInput(".5")).toBe("0.5");
  });

  it("caps fractional digits at two", () => {
    expect(normalizeMoneyDecimalInput("10.256")).toBe("10.25");
    expect(normalizeMoneyDecimalInput("0.999")).toBe("0.99");
  });

  it("normalizes comma as decimal separator", () => {
    expect(normalizeMoneyDecimalInput("1,25")).toBe("1.25");
  });

  it("preserves trailing dot while typing decimals", () => {
    expect(normalizeMoneyDecimalInput("10.")).toBe("10.");
  });

  it("collapses multiple dots", () => {
    expect(normalizeMoneyDecimalInput("1.2.34")).toBe("1.23");
  });
});

describe("normalizeRatioDecimalInput", () => {
  it("allows up to eight fractional digits", () => {
    expect(normalizeRatioDecimalInput("0.123")).toBe("0.123");
    expect(normalizeRatioDecimalInput("0.12345678")).toBe("0.12345678");
    expect(normalizeRatioDecimalInput("0.123456789")).toBe("0.12345678");
  });

  it("preserves two decimal forms while typing", () => {
    expect(normalizeRatioDecimalInput("0.10")).toBe("0.10");
    expect(normalizeRatioDecimalInput("0.5")).toBe("0.5");
  });

  it("still caps at two decimals for money normalizer", () => {
    expect(normalizeMoneyDecimalInput("0.123")).toBe("0.12");
    expect(normalizeMoneyDecimalInput("0.999")).toBe("0.99");
  });
});
