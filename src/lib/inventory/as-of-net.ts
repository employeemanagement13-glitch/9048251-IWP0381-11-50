/**
 * Warehouse closing stock as of the period end date.
 *
 * `From` only splits prior vs period (Opening / Total IN / Total OUT).
 * It must not change closing Net — that figure is physical stock as of `To`.
 *
 * Opening is displayed as max(0, priorIn − priorOut). Using that clamped
 * opening in the closing formula overstates Net whenever the prior position
 * was negative. Closing therefore uses the unclamped prior position.
 */
export function warehouseNetAsOf(
  priorIn: number,
  priorOut: number,
  periodIn: number,
  periodOut: number,
): number {
  return Math.max(
    0,
    Number(priorIn || 0) - Number(priorOut || 0) + Number(periodIn || 0) - Number(periodOut || 0),
  );
}
