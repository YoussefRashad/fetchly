/** Exactly '#' and six hex digits, either case. */
const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/** The relative luminance of a checked '#RRGGBB' colour (WCAG 2.x). */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function checked(value: unknown): string {
  // The type first: a value that would coerce to a valid string (a boxed string, an array) is still rejected.
  if (typeof value !== 'string') throw new TypeError(`contrast: not a string: ${String(typeof value)}`);
  if (value.length !== 7 || !HEX6.test(value)) throw new TypeError(`contrast: not a #RRGGBB colour: ${JSON.stringify(value)}`);
  return value;
}

/**
 * The WCAG 2.x contrast ratio of two '#RRGGBB' colours (either case): (Lmax + 0.05) / (Lmin + 0.05).
 * Raw, never rounded, always >= 1, and the same whichever order the colours come in.
 * @throws {TypeError} when either value is not a string of exactly '#' and six hex digits.
 */
export function contrast(a: string, b: string): number {
  const la = luminance(checked(a));
  const lb = luminance(checked(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
