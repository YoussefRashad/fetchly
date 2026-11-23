/** A C0 control character or DEL. No g or y flag, so test() keeps no state between calls. */
// eslint-disable-next-line no-control-regex
export const CONTROL = /[\u0000-\u001f\u007f]/u;
