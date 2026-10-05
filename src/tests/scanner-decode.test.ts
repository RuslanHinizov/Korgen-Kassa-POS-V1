import { describe, expect, it } from "vitest";
import { ScanBurst, isScanTerminator, keyToChar } from "@/lib/scanner-decode";

const k = (code: string, shiftKey = false, key = "") => ({ code, key, shiftKey });

describe("keyToChar — reads the physical key, not the layout's character", () => {
  it("digits are digits, also from the numpad and also when Shift is held (a scanner made for another country)", () => {
    expect(keyToChar(k("Digit4"))).toBe("4");
    expect(keyToChar(k("Numpad7"))).toBe("7");
    expect(keyToChar(k("Digit2", true, '"'))).toBe("2");
  });
  it("letters come out Latin even when the Russian layout is active", () => {
    expect(keyToChar(k("KeyY", false, "н"))).toBe("y");
    expect(keyToChar(k("KeyR", true, "К"))).toBe("R");
  });
  it("the symbols a Code 128 label can hold", () => {
    expect(keyToChar(k("Minus"))).toBe("-");
    expect(keyToChar(k("Slash", false, "."))).toBe("/");
    expect(keyToChar(k("Period"))).toBe(".");
  });
  it("keys that are not part of a barcode give nothing", () => {
    expect(keyToChar(k("ShiftLeft"))).toBeNull();
    expect(keyToChar(k("F5"))).toBeNull();
    expect(keyToChar(k("Enter"))).toBeNull();
  });
});

describe("scan terminators", () => {
  it("Enter, numpad Enter and Tab end a scan", () => {
    expect(isScanTerminator({ key: "Enter", code: "Enter" })).toBe(true);
    expect(isScanTerminator({ key: "Enter", code: "NumpadEnter" })).toBe(true);
    expect(isScanTerminator({ key: "Tab", code: "Tab" })).toBe(true);
    expect(isScanTerminator({ key: "a", code: "KeyA" })).toBe(false);
  });
});

describe("ScanBurst", () => {
  it("six or more fast keys are a scan", () => {
    const b = new ScanBurst();
    "4870206415627".split("").forEach((c, i) => b.push(c, 1000 + i * 10));
    expect(b.text()).toBe("4870206415627");
  });
  it("a person typing slowly is not a scan", () => {
    const b = new ScanBurst();
    "4870206".split("").forEach((c, i) => b.push(c, 1000 + i * 250));
    expect(b.text()).toBeNull();
  });
  it("a pause starts a new burst: only the last scan counts", () => {
    const b = new ScanBurst();
    "123456".split("").forEach((c, i) => b.push(c, 1000 + i * 10));
    "9988776".split("").forEach((c, i) => b.push(c, 3000 + i * 10));
    expect(b.text()).toBe("9988776");
  });
  it("too short is not a scan", () => {
    const b = new ScanBurst();
    "12345".split("").forEach((c, i) => b.push(c, 1000 + i * 10));
    expect(b.text()).toBeNull();
  });
  it("clear forgets the burst", () => {
    const b = new ScanBurst();
    "1234567".split("").forEach((c, i) => b.push(c, 1000 + i * 10));
    b.clear();
    expect(b.text()).toBeNull();
  });
});
