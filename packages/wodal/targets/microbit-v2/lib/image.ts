import type { Image } from "wendoo";

/**
 * Builds an {@link Image} from a multiline art string.
 *
 * Each non-blank line is a row; within a row each significant character is one
 * pixel. A hex digit `0`-`f` (lowercase) is a brightness level mapped to the
 * full 0-255 range as `n * 17` (so `f` is 255); a `.` is brightness 0. Spaces
 * and tabs are insignificant separators for visual alignment; newlines delimit
 * rows; leading and trailing blank lines are ignored.
 *
 * The width is taken from the first non-blank row and the height is the number
 * of non-blank rows. Ragged rows are not an error: a row with fewer pixels than
 * the width is padded on the right with brightness 0, and a row with more is
 * truncated to the width.
 */
export function image(art: string): Image {
  const hexDigits = "0123456789abcdef";
  const lines = art.split("\n");
  const pixels: number[] = [];
  let width = 0;
  let height = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const row: number[] = [];
    for (let c = 0; c < line.length; c++) {
      const ch = line.charAt(c);
      if (ch === " " || ch === "\t") continue;
      row.push(ch === "." ? 0 : hexDigits.indexOf(ch) * 17);
    }
    if (row.length === 0) continue;
    if (width === 0) width = row.length;
    for (let c = 0; c < width; c++) {
      pixels.push(c < row.length ? row[c] : 0);
    }
    height++;
  }
  return { width, height, pixels: Buffer.from(pixels) };
}

/** Returns a 5x5 heart {@link Image}. */
export function heart(): Image {
  return image(`
. f . f .
f f f f f
f f f f f
. f f f .
. . f . .
`);
}

/** Returns a 5x5 smiling-face {@link Image}. */
export function happy(): Image {
  return image(`
. . . . .
. f . f .
. . . . .
f . . . f
. f f f .
`);
}

/** Returns a 5x5 frowning-face {@link Image}. */
export function sad(): Image {
  return image(`
. . . . .
. f . f .
. . . . .
. f f f .
f . . . f
`);
}

/** Returns a 5x5 arrow {@link Image} pointing north (up). */
export function arrowNorth(): Image {
  return image(`
. . f . .
. f f f .
f . f . f
. . f . .
. . f . .
`);
}

/** Returns a 5x5 arrow {@link Image} pointing south (down). */
export function arrowSouth(): Image {
  return image(`
. . f . .
. . f . .
f . f . f
. f f f .
. . f . .
`);
}

/** Returns a 5x5 arrow {@link Image} pointing east (right). */
export function arrowEast(): Image {
  return image(`
. . f . .
. . . f .
f f f f f
. . . f .
. . f . .
`);
}

/** Returns a 5x5 arrow {@link Image} pointing west (left). */
export function arrowWest(): Image {
  return image(`
. . f . .
. f . . .
f f f f f
. f . . .
. . f . .
`);
}
