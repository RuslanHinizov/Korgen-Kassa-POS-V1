/**
 * Label printers of the Xprinter XP-3xxB family (XP-365B …) speak TSPL: the label size and the gap between labels are set
 * by commands and the picture is sent as a monochrome bitmap, so every label is cut at the right place whatever the
 * Windows driver thinks. 203 dpi = 8 dots per millimetre.
 */
const DOTS_PER_MM = 8;

function dotsFor(mm) {
  return Math.round(mm * DOTS_PER_MM);
}

/**
 * bgra = the label picture (4 bytes per pixel, width x height dots). In TSPL BITMAP data a 0 bit is a black dot and a 1 bit
 * is white, so the rows are inverted unless `invert` is false (a printer that wants it the other way round).
 */
function tsplLabel({ bgra, width, height, widthMm, heightMm, gapMm = 2, copies = 1, invert = true, direction = 0 }) {
  const bytesPerRow = Math.ceil(width / 8);
  const rows = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < bytesPerRow; bx++) {
      let b = 0;
      for (let i = 0; i < 8; i++) {
        const x = bx * 8 + i;
        let black = 0;
        if (x < width) {
          const o = (y * width + x) * 4;
          const lum = 0.114 * bgra[o] + 0.587 * bgra[o + 1] + 0.299 * bgra[o + 2];
          black = bgra[o + 3] > 40 && lum < 165 ? 1 : 0;
        }
        b = (b << 1) | black;
      }
      rows[y * bytesPerRow + bx] = invert ? ~b & 0xff : b;
    }
  }
  const n = Math.min(99, Math.max(1, Math.round(copies) || 1));
  const head = `SIZE ${widthMm} mm,${heightMm} mm\r\nGAP ${gapMm} mm,0 mm\r\nDIRECTION ${direction}\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,${bytesPerRow},${height},0,`;
  return { data: Buffer.concat([Buffer.from(head, "ascii"), rows, Buffer.from(`\r\nPRINT ${n},1\r\n`, "ascii")]), rows };
}

module.exports = { DOTS_PER_MM, dotsFor, tsplLabel };
