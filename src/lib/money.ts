const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
const audCents = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })

/** $26,138 */
export const formatAud = (n: number) => aud.format(n)
/** $26,138.50 — for actual amounts that may have cents */
export const formatAudExact = (n: number) => (Number.isInteger(n) ? aud.format(n) : audCents.format(n))

/** Parse a typed amount like "$1,200.50" → 1200.5; blank → null */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
