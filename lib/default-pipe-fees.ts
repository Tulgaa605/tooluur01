/** Оролтын шугамын голчийн суурь хураамж — шинэ нягтланд анхдагч */
export const STANDARD_OFFICE_PIPE_FEES: Array<{
  diameterMm: number
  baseCleanFee: number
  baseDirtyFee: number
}> = [
  { diameterMm: 15, baseCleanFee: 2800, baseDirtyFee: 1000 },
  { diameterMm: 16, baseCleanFee: 1000, baseDirtyFee: 0 },
  { diameterMm: 17, baseCleanFee: 1000, baseDirtyFee: 500 },
  { diameterMm: 20, baseCleanFee: 3840, baseDirtyFee: 1200 },
  { diameterMm: 25, baseCleanFee: 6000, baseDirtyFee: 1800 },
  { diameterMm: 32, baseCleanFee: 8800, baseDirtyFee: 2700 },
  { diameterMm: 40, baseCleanFee: 13200, baseDirtyFee: 4000 },
  { diameterMm: 50, baseCleanFee: 20800, baseDirtyFee: 6400 },
  { diameterMm: 65, baseCleanFee: 7900, baseDirtyFee: 7900 },
  { diameterMm: 80, baseCleanFee: 10500, baseDirtyFee: 10500 },
  { diameterMm: 100, baseCleanFee: 15280, baseDirtyFee: 15280 },
  { diameterMm: 125, baseCleanFee: 18500, baseDirtyFee: 18500 },
  { diameterMm: 150, baseCleanFee: 25200, baseDirtyFee: 25200 },
  { diameterMm: 200, baseCleanFee: 31200, baseDirtyFee: 31200 },
  { diameterMm: 250, baseCleanFee: 43000, baseDirtyFee: 43000 },
  { diameterMm: 300, baseCleanFee: 59800, baseDirtyFee: 59800 },
  { diameterMm: 400, baseCleanFee: 76800, baseDirtyFee: 76800 },
]

/** Өмнөх хувилбар: Ц=Б нэг baseFee (хуучин автомат seed) */
const LEGACY_OFFICE_PIPE_FEES: Array<{ diameterMm: number; baseFee: number }> = [
  { diameterMm: 15, baseFee: 1000 },
  { diameterMm: 20, baseFee: 1200 },
  { diameterMm: 25, baseFee: 1800 },
  { diameterMm: 32, baseFee: 2700 },
  { diameterMm: 40, baseFee: 4000 },
  { diameterMm: 50, baseFee: 6400 },
  { diameterMm: 65, baseFee: 7900 },
  { diameterMm: 80, baseFee: 10500 },
  { diameterMm: 100, baseFee: 15280 },
  { diameterMm: 125, baseFee: 18500 },
  { diameterMm: 150, baseFee: 25200 },
  { diameterMm: 200, baseFee: 31200 },
  { diameterMm: 250, baseFee: 43000 },
  { diameterMm: 300, baseFee: 59800 },
  { diameterMm: 400, baseFee: 76800 },
]

function isLegacyOfficePipeFeeRow(
  diameterMm: number,
  baseCleanFee: number,
  baseDirtyFee: number
): boolean {
  const legacy = LEGACY_OFFICE_PIPE_FEES.find((l) => l.diameterMm === diameterMm)
  if (!legacy) return false
  return baseCleanFee === legacy.baseFee && baseDirtyFee === legacy.baseFee
}

/** Хоосон эсвэл хуучин анхдагч байвал шинэ стандартаар шинэчлэх */
export function shouldRefreshOfficePipeFee(
  standard: { diameterMm: number; baseCleanFee: number; baseDirtyFee: number },
  existing: { baseCleanFee: number; baseDirtyFee: number }
): boolean {
  const clean = existing.baseCleanFee ?? 0
  const dirty = existing.baseDirtyFee ?? 0
  if (clean === standard.baseCleanFee && dirty === standard.baseDirtyFee) return false
  if (clean === 0 && dirty === 0) return true
  return isLegacyOfficePipeFeeRow(standard.diameterMm, clean, dirty)
}
