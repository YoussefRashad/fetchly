import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO, LOGO_BOX, LOGO_COLORS, LOGO_SHAPES, strokePath, type LogoPoint, type LogoStroke } from '../src/shared/logo';

describe('logo: box and colours', () => {
  it('is drawn in a 256-unit box', () => {
    expect(LOGO_BOX).toBe(256);
  });

  it('has the three fixed colours', () => {
    expect(LOGO_COLORS).toEqual({ plate: '#1E3AA8', strand: '#FFFFFF', strandAlt: '#4FE0CC' });
  });

  it('paints every shape with those colours', () => {
    expect(LOGO.plate.fill).toBe(LOGO_COLORS.plate);
    expect(LOGO.left.color).toBe(LOGO_COLORS.strand);
    expect(LOGO.right.color).toBe(LOGO_COLORS.strandAlt);
    expect(LOGO.stem.color).toBe(LOGO_COLORS.strand);
    expect(LOGO.head.fill).toBe(LOGO_COLORS.strand);
  });
});

describe('logo: the shapes', () => {
  it('has a rounded plate', () => {
    expect(LOGO.plate).toEqual({ kind: 'rect', x: 8, y: 8, width: 240, height: 240, radius: 60, fill: '#1E3AA8' });
  });

  it('has a white left strand: down, then curving to the centre', () => {
    expect(LOGO.left).toEqual({
      kind: 'stroke',
      start: [84, 40],
      segments: [
        { kind: 'line', to: [84, 92] },
        { kind: 'quad', control: [84, 132], to: [128, 152] },
      ],
      width: 30,
      cap: 'round',
      color: '#FFFFFF',
    });
  });

  it('has a teal right strand that mirrors the left one', () => {
    expect(LOGO.right).toEqual({
      kind: 'stroke',
      start: [172, 40],
      segments: [
        { kind: 'line', to: [172, 92] },
        { kind: 'quad', control: [172, 132], to: [128, 152] },
      ],
      width: 30,
      cap: 'round',
      color: '#4FE0CC',
    });
  });

  it('has a white stem under the join', () => {
    expect(LOGO.stem).toEqual({
      kind: 'stroke',
      start: [128, 150],
      segments: [{ kind: 'line', to: [128, 176] }],
      width: 30,
      cap: 'round',
      color: '#FFFFFF',
    });
  });

  it('has a white arrow head', () => {
    expect(LOGO.head).toEqual({
      kind: 'polygon',
      points: [
        [88, 170],
        [168, 170],
        [128, 220],
      ],
      fill: '#FFFFFF',
    });
  });

  it('has exactly the five shapes plate, left, right, stem and head', () => {
    expect(Object.keys(LOGO).sort()).toEqual(['head', 'left', 'plate', 'right', 'stem']);
  });

  it('strokes are held as points and segments, not as an SVG string', () => {
    for (const stroke of [LOGO.left, LOGO.right, LOGO.stem]) {
      expect(Array.isArray(stroke.start)).toBe(true);
      expect(Array.isArray(stroke.segments)).toBe(true);
      expect(stroke).not.toHaveProperty('d');
      expect(stroke).not.toHaveProperty('path');
    }
  });
});

describe('LOGO_SHAPES', () => {
  it('lists the same five objects back to front: plate, left, right, stem, head', () => {
    expect(LOGO_SHAPES).toHaveLength(5);
    expect(LOGO_SHAPES[0]).toBe(LOGO.plate);
    expect(LOGO_SHAPES[1]).toBe(LOGO.left);
    expect(LOGO_SHAPES[2]).toBe(LOGO.right);
    expect(LOGO_SHAPES[3]).toBe(LOGO.stem);
    expect(LOGO_SHAPES[4]).toBe(LOGO.head);
  });

  it('has the kinds in paint order', () => {
    expect(LOGO_SHAPES.map((shape) => shape.kind)).toEqual(['rect', 'stroke', 'stroke', 'stroke', 'polygon']);
  });
});

describe('strokePath', () => {
  it('writes the left strand as M, L and Q commands joined by single spaces', () => {
    expect(strokePath(LOGO.left)).toBe('M84 40 L84 92 Q84 132 128 152');
  });

  it('writes the right strand', () => {
    expect(strokePath(LOGO.right)).toBe('M172 40 L172 92 Q172 132 128 152');
  });

  it('writes the stem', () => {
    expect(strokePath(LOGO.stem)).toBe('M128 150 L128 176');
  });

  it('writes a vertical run as an L command, never V', () => {
    for (const stroke of [LOGO.left, LOGO.right, LOGO.stem]) expect(strokePath(stroke)).not.toMatch(/[VvHh]/);
  });

  // A stroke built here, so the helper is tested beyond the three shipped ones.
  const make = (start: LogoPoint, segments: LogoStroke['segments']): LogoStroke => ({ kind: 'stroke', start, segments, width: 30, cap: 'round', color: '#FFFFFF' });

  it('writes only M for a stroke with no segment', () => {
    expect(strokePath(make([3, 4], []))).toBe('M3 4');
  });

  it('writes one command per segment, in order, whatever the mix of lines and curves', () => {
    const stroke = make(
      [1, 2],
      [
        { kind: 'quad', control: [3, 4], to: [5, 6] },
        { kind: 'line', to: [7, 8] },
        { kind: 'quad', control: [9, 10], to: [11, 12] },
        { kind: 'line', to: [13, 14] },
      ],
    );
    expect(strokePath(stroke)).toBe('M1 2 Q3 4 5 6 L7 8 Q9 10 11 12 L13 14');
  });

  it('writes numbers as JavaScript prints them: decimals and negatives included, no rounding, no padding', () => {
    const stroke = make(
      [1.5, -2],
      [
        { kind: 'line', to: [0.25, 100] },
        { kind: 'quad', control: [-3.125, 0], to: [7, -0.5] },
      ],
    );
    expect(strokePath(stroke)).toBe('M1.5 -2 L0.25 100 Q-3.125 0 7 -0.5');
  });

  it('has no leading, trailing or doubled whitespace', () => {
    for (const stroke of [LOGO.left, LOGO.right, LOGO.stem]) {
      const d = strokePath(stroke);
      expect(d).toBe(d.trim());
      expect(d).not.toMatch(/ {2}/);
      expect(d).not.toMatch(/,/);
    }
  });

  it('does not change the stroke it is given', () => {
    const before = JSON.stringify(LOGO);
    strokePath(LOGO.left);
    strokePath(LOGO.right);
    strokePath(LOGO.stem);
    expect(JSON.stringify(LOGO)).toBe(before);
  });
});

describe('the mirror property', () => {
  /** Every point of a stroke in order: the start, then for each segment its control (when it has one) and its end. */
  const points = (stroke: LogoStroke): LogoPoint[] => [stroke.start, ...stroke.segments.flatMap((s) => (s.kind === 'quad' ? [s.control, s.to] : [s.to]))];

  it('puts every point of the right strand at [256 - x, y] of the matching point of the left strand', () => {
    const left = points(LOGO.left);
    const right = points(LOGO.right);
    expect(right).toHaveLength(left.length);
    // start, the line's end, the curve's control and the curve's end
    expect(left).toHaveLength(4);
    left.forEach(([x, y], i) => {
      expect(right[i], `point ${i}`).toEqual([LOGO_BOX - x, y]);
    });
  });

  it('has the same segment kinds, width and cap on both strands', () => {
    expect(LOGO.right.segments.map((s) => s.kind)).toEqual(LOGO.left.segments.map((s) => s.kind));
    expect(LOGO.right.width).toBe(LOGO.left.width);
    expect(LOGO.right.cap).toBe(LOGO.left.cap);
  });
});

describe('the pixels architecture 7.8 relies on (paint order and extent)', () => {
  const distanceToSegment = ([px, py]: LogoPoint, [ax, ay]: LogoPoint, [bx, by]: LogoPoint): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  const insideHead = ([px, py]: LogoPoint): boolean => {
    const pts = LOGO.head.points;
    const sign = (p: LogoPoint, a: LogoPoint, b: LogoPoint): number => (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const [a, b, c] = pts as readonly [LogoPoint, LogoPoint, LogoPoint];
    const d1 = sign([px, py], a, b);
    const d2 = sign([px, py], b, c);
    const d3 = sign([px, py], c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };

  it('has (128, 196) in the head and out of the stem', () => {
    expect(insideHead([128, 196])).toBe(true);
    const stemEnd = LOGO.stem.segments[0]?.to as LogoPoint;
    expect(distanceToSegment([128, 196], LOGO.stem.start, stemEnd)).toBeGreaterThan(LOGO.stem.width / 2);
  });

  it('has (172, 60) on the teal strand and off the white one', () => {
    const rightEnd = LOGO.right.segments[0]?.to as LogoPoint;
    const leftEnd = LOGO.left.segments[0]?.to as LogoPoint;
    expect(distanceToSegment([172, 60], LOGO.right.start, rightEnd)).toBeLessThanOrEqual(LOGO.right.width / 2);
    expect(distanceToSegment([172, 60], LOGO.left.start, leftEnd)).toBeGreaterThan(LOGO.left.width / 2);
  });
});

describe('logo.ts is plain data', () => {
  const source = (): string =>
    readFileSync(fileURLToPath(new URL('../src/shared/logo.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports nothing', () => {
    expect(source()).not.toMatch(/^\s*import\b/m);
    expect(source()).not.toMatch(/\bimport\s*\(/);
    expect(source()).not.toMatch(/\brequire\s*\(/);
    expect(source()).not.toMatch(/\bfrom\s+['"]/);
  });

  it('uses no DOM or Node API', () => {
    expect(source()).not.toMatch(/\b(document|window|navigator|process|Buffer|globalThis|HTMLElement|SVGElement|node:fs|node:path)\b/);
  });
});
