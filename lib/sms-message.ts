export type MeterUsageSmsLine = { meterNumber: string; usage: number; usageLabel?: string }

function formatUsageM3(usage: number): string {
  const n = Number(usage)
  if (!Number.isFinite(n) || n < 0) return '0.00'
  return n.toFixed(2)
}

function truncateText(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  if (max <= 3) return t.slice(0, max)
  return `${t.slice(0, max - 3)}...`
}

function formatMeterLine(m: MeterUsageSmsLine): string {
  const num = String(m.meterNumber).trim()
  if (m.usageLabel) return `Тоолуур ${num}: ${m.usageLabel}`
  return `Тоолуур ${num}: ${formatUsageM3(m.usage)} м³`
}

/**
 * Нэг SMS текст — нэр, код, тоолуур/хэрэглээ, төлбөр, задаргааны холбоос.
 */
export type AdditionalFeeSmsLine = { name: string; amount: number }

export function buildSmsMessage(input: {
  organizationName: string
  organizationCode?: string | null
  meterLines: MeterUsageSmsLine[]
  total: number
  /** Өмнөх саруудаас шилжсэн үлдэгдэл — байвал тусад нь мөр болж харагдана */
  previousRemaining?: number | null
  /** Бусад нэмэлт төлбөр — задаргааны холбоос дээр дэлгэрэнгүй */
  additionalFeeLines?: AdditionalFeeSmsLine[]
  breakdownUrl?: string | null
}): string {
  const orgName = String(input.organizationName ?? '').trim()
  const orgCode = String(input.organizationCode ?? '').trim()
  const sortedMeters = [...input.meterLines]
    .filter((m) => String(m.meterNumber ?? '').trim())
    .sort((a, b) => String(a.meterNumber).localeCompare(String(b.meterNumber), 'mn'))

  const url = (input.breakdownUrl ?? '').trim()
  const footer = url ? `Төлбөрийн задаргаа: ${url}` : ''

  const prevRem = Number(input.previousRemaining ?? 0)
  const prevLine =
    Number.isFinite(prevRem) && Math.abs(prevRem) >= 1
      ? prevRem < 0
        ? `Илүү төлөлт: ${Math.round(Math.abs(prevRem)).toLocaleString('en-US')}₮`
        : `Өмнөх үлдэгдэл: ${Math.round(prevRem).toLocaleString('en-US')}₮`
      : ''

  const grandTotal =
    (Number.isFinite(input.total) ? input.total : 0) +
    (Number.isFinite(prevRem) ? prevRem : 0)
  const totalLine =
    Number.isFinite(grandTotal) && grandTotal > 0
      ? `Төлбөр: ${Math.round(grandTotal).toLocaleString('en-US')}₮`
      : Number.isFinite(grandTotal) && grandTotal <= 0 && prevRem < 0
        ? 'Төлбөр: 0₮ (илүү төлөлт хасагдсан)'
        : ''

  const feeLines = (input.additionalFeeLines ?? [])
    .filter((f) => String(f.name ?? '').trim() && Number(f.amount) > 0)
    .map((f) => {
      const amt = Math.round(Number(f.amount) || 0)
      return `${String(f.name).trim()}: ${amt.toLocaleString('en-US')}₮`
    })
  const feeText = feeLines.join('\n')

  const buildBody = (name: string, code: string, meterText: string, feesText: string) => {
    const parts = [`Нэр: ${name}`]
    if (code) parts.push(`Код: ${code}`)
    if (meterText) parts.push(meterText)
    if (feesText) parts.push(feesText)
    if (prevLine) parts.push(prevLine)
    if (totalLine) parts.push(totalLine)
    if (footer) parts.push(footer)
    return parts.join('\n')
  }

  let meterText = sortedMeters.map(formatMeterLine).join('\n')
  let feesText = feeText
  let message = buildBody(orgName, orgCode, meterText, feesText)

  const maxLen = 480
  if (message.length <= maxLen) return message

  if (sortedMeters.length > 3) {
    const lines = sortedMeters.slice(0, 3).map(formatMeterLine)
    const extra = sortedMeters.length - 3
    if (extra > 0) lines.push(`+${extra} тоолуур`)
    meterText = lines.join('\n')
    message = buildBody(truncateText(orgName, 48), orgCode, meterText, feesText)
  }

  if (message.length > maxLen && feeLines.length > 2) {
    feesText = feeLines.slice(0, 2).join('\n')
    if (feeLines.length > 2) feesText += `\n+${feeLines.length - 2} нэмэлт`
    message = buildBody(truncateText(orgName, 48), orgCode, meterText, feesText)
  }

  if (message.length > maxLen) {
    meterText = sortedMeters.length > 0 ? `${sortedMeters.length} тоолуур` : ''
    feesText = feeLines.length > 0 ? `${feeLines.length} нэмэлт төлбөр` : ''
    message = buildBody(truncateText(orgName, 32), truncateText(orgCode, 20), meterText, feesText)
  }

  if (message.length > maxLen && footer) {
    const withoutFooter = buildBody(truncateText(orgName, 40), truncateText(orgCode, 16), meterText, feesText)
    const room = maxLen - withoutFooter.length - 1
    if (room > 24) {
      message = `${withoutFooter}\n${truncateText(footer, room)}`
    } else {
      message = withoutFooter.slice(0, maxLen)
    }
  }

  return message.slice(0, maxLen)
}
