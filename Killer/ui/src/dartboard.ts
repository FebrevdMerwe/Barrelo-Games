/** Standard dartboard wedge order, clockwise starting at the top (12 o'clock). */
export const WEDGE_ORDER = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

/** Ring radii as a fraction of the outer double-ring radius, based on real dartboard proportions. */
const RING_FRACTIONS = {
  bullInner: 6.35 / 170,
  bullOuter: 15.9 / 170,
  tripleInner: 99 / 170,
  tripleOuter: 107 / 170,
  doubleInner: 162 / 170,
  doubleOuter: 1,
};

export function getRingRadii(boardRadius: number) {
  return {
    bullInner: RING_FRACTIONS.bullInner * boardRadius,
    bullOuter: RING_FRACTIONS.bullOuter * boardRadius,
    tripleInner: RING_FRACTIONS.tripleInner * boardRadius,
    tripleOuter: RING_FRACTIONS.tripleOuter * boardRadius,
    doubleInner: RING_FRACTIONS.doubleInner * boardRadius,
    doubleOuter: RING_FRACTIONS.doubleOuter * boardRadius,
  };
}
