/**
 * Barcode scanners that act as a keyboard ("keyboard wedge") press keys, and Windows turns those key presses into
 * characters with the keyboard layout that happens to be active. On a till set to the Russian layout a barcode with
 * letters comes out as Cyrillic, and a scanner set up for another country sends digits shifted. The PHYSICAL key
 * (`KeyboardEvent.code`) does not depend on the layout, so the till reads that instead.
 */

export interface KeyInfo {
  code: string;
  key: string;
  shiftKey: boolean;
}

const SYMBOLS: Record<string, [string, string]> = {
  Minus: ["-", "_"], Slash: ["/", "?"], Period: [".", ">"], Comma: [",", "<"], Semicolon: [";", ":"], Quote: ["'", '"'],
  Backquote: ["`", "~"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"], Equal: ["=", "+"],
  Space: [" ", " "], NumpadDecimal: [".", "."], NumpadSubtract: ["-", "-"], NumpadAdd: ["+", "+"], NumpadDivide: ["/", "/"],
  NumpadMultiply: ["*", "*"],
};

/** The character of the physical key, as on an English keyboard; null for keys that are not part of a barcode. */
export function keyToChar(e: KeyInfo): string | null {
  // digits are digits whatever Shift or layout says (a scanner made for another country sends them shifted)
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  const symbol = SYMBOLS[e.code];
  if (symbol) return e.shiftKey ? symbol[1] : symbol[0];
  return null;
}

/** Keys that end a scan: Enter, the numpad Enter, or Tab (a common scanner "suffix"). */
export function isScanTerminator(e: { code: string; key: string }): boolean {
  return e.key === "Enter" || e.code === "NumpadEnter" || e.key === "Tab";
}

/** A scanner types every character within a few milliseconds of the previous one; a person is far slower. */
export const SCAN_MAX_GAP_MS = 80;
export const SCAN_MIN_LENGTH = 6;
/** No terminator for this long after the last key: the scan is over (the scanner is set to send no Enter). */
export const SCAN_IDLE_MS = 120;

export class ScanBurst {
  private keys: { c: string; t: number }[] = [];

  push(c: string, t = Date.now()): void {
    const last = this.keys[this.keys.length - 1];
    if (last && t - last.t > SCAN_MAX_GAP_MS) this.keys = [];
    this.keys.push({ c, t });
  }

  clear(): void {
    this.keys = [];
  }

  /** The scanned text when the recent keys are a scanner burst (long enough, every key right after the last), else null. */
  text(minLength = SCAN_MIN_LENGTH): string | null {
    if (this.keys.length < minLength) return null;
    return this.keys.map((k) => k.c).join("");
  }
}
