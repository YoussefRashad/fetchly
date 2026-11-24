import { ICONS, MIRRORED_ICONS, type IconName } from '../model/icons';

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

/**
 * One stroke-only svg, hidden from assistive technology: a control's name comes from its aria-label or its text.
 * Icons in MIRRORED_ICONS get the icon-mirror class, which flips them under RTL.
 */
export function Icon({ name, size = 16, className }: Props) {
  const classes = ['icon'];
  if (MIRRORED_ICONS.has(name)) classes.push('icon-mirror');
  if (className) classes.push(className);
  return (
    <svg
      className={classes.join(' ')}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name].map((shape, i) =>
        shape.tag === 'path' ? (
          <path key={i} d={shape.d} />
        ) : shape.tag === 'circle' ? (
          <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} />
        ) : (
          <rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
        ),
      )}
    </svg>
  );
}
