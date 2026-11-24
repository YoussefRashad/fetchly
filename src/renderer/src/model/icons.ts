/**
 * The app's icon set: names and stroke-only geometry in a 24-unit box. Pure data, so a node test can read it;
 * `components/Icon.tsx` only renders it. A name never changes meaning; a later component may add one, never rename or remove.
 */

export const ICON_NAMES = [
  'pause',
  'play',
  'close',
  'retry',
  'trash',
  'folder',
  'gear',
  'chevronDown',
  'chevronEnd',
  'check',
  'alert',
  'link',
  'list',
  'download',
  'open',
  'film',
  'music',
  'file',
  'stack',
  'palette',
  'globe',
  'wrench',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export type IconShape =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: number; cy: number; r: number }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const path = (d: string): IconShape => ({ tag: 'path', d });
const circle = (cx: number, cy: number, r: number): IconShape => ({ tag: 'circle', cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx: number): IconShape => ({ tag: 'rect', x, y, width, height, rx });

export const ICONS: Readonly<Record<IconName, readonly IconShape[]>> = {
  pause: [path('M9 6v12M15 6v12')],
  play: [path('M8.25 5.25l10.5 6.75-10.5 6.75z')],
  close: [path('M6 6l12 12M18 6l-12 12')],
  retry: [path('M18.75 12a6.75 6.75 0 1 1-1.95-4.8'), path('M18.75 3.75v4.5h-4.5')],
  trash: [path('M4.5 6.75h15'), path('M9.75 6.75V4.5h4.5v2.25'), path('M6.75 6.75l.75 13.5h9l.75-13.5'), path('M10.5 10.5v6M13.5 10.5v6')],
  folder: [path('M3 6.75h6l2.25 2.25H21v9.75H3z')],
  gear: [circle(12, 12, 3.3), path('M12 2.25v3M12 18.75v3M2.25 12h3M18.75 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1')],
  chevronDown: [path('M6 9l6 6 6-6')],
  chevronEnd: [path('M9 6l6 6-6 6')],
  check: [path('M5.25 12.75l4.5 4.5 9-10.5')],
  alert: [path('M12 3l9.75 17.25h-19.5z'), path('M12 9.75v5.25M12 18v.3')],
  link: [
    path('M10.5 13.5a4.5 4.5 0 0 0 6.3 0l3-3a4.5 4.5 0 0 0-6.3-6.3l-1.2 1.2'),
    path('M13.5 10.5a4.5 4.5 0 0 0-6.3 0l-3 3A4.5 4.5 0 0 0 10.5 19.8l1.2-1.2'),
  ],
  list: [path('M4.5 6h15M4.5 12h15M4.5 18h15')],
  download: [path('M12 3.75v12.75M6.75 11.25L12 16.5l5.25-5.25M4.5 20.25h15')],
  open: [path('M13.5 3.75h6.75V10.5'), path('M20.25 3.75L11.25 12.75'), path('M18 14.25v6H3.75V6H9.75')],
  film: [rect(3, 4.5, 18, 15, 2.25), path('M7.5 4.5v15M16.5 4.5v15M3 9.75h4.5M16.5 9.75h4.5M3 14.25h4.5M16.5 14.25h4.5')],
  music: [path('M9 18V5.25l10.5-2.25V15'), circle(6.75, 18, 2.25), circle(17.25, 15, 2.25)],
  file: [path('M6 2.25h8.25L18.75 6.75V21.75H6z'), path('M14.25 2.25v4.5h4.5')],
  stack: [rect(3.75, 8.25, 16.5, 12, 2.25), path('M6 5.25h12M8.25 2.7h7.5')],
  palette: [circle(12, 12, 9), circle(8.25, 10.5, 1.05), circle(12, 7.5, 1.05), circle(15.75, 10.5, 1.05)],
  globe: [path('M3 12h18'), circle(12, 12, 9)],
  wrench: [path('M15 3.75a4.5 4.5 0 0 0-4.2 6L3.75 16.8l3.45 3.45 7.05-7.05a4.5 4.5 0 0 0 6-4.2l-2.7 1.8-2.55-2.55z')],
};

/** Icons that point along the reading direction (D2): they flip under RTL, through the `icon-mirror` class. */
export const MIRRORED_ICONS: ReadonlySet<IconName> = new Set<IconName>(['chevronEnd', 'open']);
