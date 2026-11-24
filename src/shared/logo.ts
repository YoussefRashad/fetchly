/**
 * The Fetchly mark ("Zip"): geometry and colours in a 256-unit box, as plain data.
 * Strokes are points and segments, not SVG strings, so a rasteriser needs no path parser; `strokePath` gives the SVG `d`.
 * Imports nothing and uses no DOM or Node API, so the renderer and main can both read it.
 * The colours are fixed in both modes and are not palette tokens.
 */

export type LogoPoint = readonly [x: number, y: number];

export type LogoSegment = { kind: 'line'; to: LogoPoint } | { kind: 'quad'; control: LogoPoint; to: LogoPoint };

export interface LogoRect {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fill: string;
}

export interface LogoStroke {
  kind: 'stroke';
  start: LogoPoint;
  segments: readonly LogoSegment[];
  width: number;
  cap: 'round';
  color: string;
}

export interface LogoPolygon {
  kind: 'polygon';
  points: readonly LogoPoint[];
  fill: string;
}

export type LogoShape = LogoRect | LogoStroke | LogoPolygon;

export const LOGO_BOX = 256;

export const LOGO_COLORS = { plate: '#1E3AA8', strand: '#FFFFFF', strandAlt: '#4FE0CC' } as const;

const plate: LogoRect = { kind: 'rect', x: 8, y: 8, width: 240, height: 240, radius: 60, fill: LOGO_COLORS.plate };

const left: LogoStroke = {
  kind: 'stroke',
  start: [84, 40],
  segments: [
    { kind: 'line', to: [84, 92] },
    { kind: 'quad', control: [84, 132], to: [128, 152] },
  ],
  width: 30,
  cap: 'round',
  color: LOGO_COLORS.strand,
};

const right: LogoStroke = {
  kind: 'stroke',
  start: [172, 40],
  segments: [
    { kind: 'line', to: [172, 92] },
    { kind: 'quad', control: [172, 132], to: [128, 152] },
  ],
  width: 30,
  cap: 'round',
  color: LOGO_COLORS.strandAlt,
};

const stem: LogoStroke = {
  kind: 'stroke',
  start: [128, 150],
  segments: [{ kind: 'line', to: [128, 176] }],
  width: 30,
  cap: 'round',
  color: LOGO_COLORS.strand,
};

const head: LogoPolygon = {
  kind: 'polygon',
  points: [
    [88, 170],
    [168, 170],
    [128, 220],
  ],
  fill: LOGO_COLORS.strand,
};

export const LOGO: {
  readonly plate: LogoRect;
  readonly left: LogoStroke;
  readonly right: LogoStroke;
  readonly stem: LogoStroke;
  readonly head: LogoPolygon;
} = { plate, left, right, stem, head };

/** Paint order, back to front: plate, left, right, stem, head. */
export const LOGO_SHAPES: readonly LogoShape[] = [plate, left, right, stem, head];

/** SVG path data of a stroke: 'M x y', then 'L x y' or 'Q cx cy x y' per segment, joined by one space. */
export function strokePath(s: LogoStroke): string {
  const parts = [`M${s.start[0]} ${s.start[1]}`];
  for (const segment of s.segments) {
    parts.push(
      segment.kind === 'line'
        ? `L${segment.to[0]} ${segment.to[1]}`
        : `Q${segment.control[0]} ${segment.control[1]} ${segment.to[0]} ${segment.to[1]}`,
    );
  }
  return parts.join(' ');
}
