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
 * Нэг SMS текст — нэр, тоолуур/хэрэглээ, төлбөр, задаргааны холбоос.
 * API нэг удаа дуудагдана; олон SMS болгон хуваахгүй.
 */
export function buildSmsMessage(input: {
  organizationName: string
  organizationCode?: string | null
  meterLines: MeterUsageSmsLine[]
  total: number
  breakdownUrl?: string | null
}): string {
  const orgRaw = `${input.organizationName}${input.organizationCode ? ` (${input.organizationCode})` : ''}`
  const sortedMeters = [...input.meterLines]
    .filter((m) => String(m.meterNumber ?? '').trim())
    .sort((a, b) => String(a.meterNumber).localeCompare(String(b.meterNumber), 'mn'))

  const url = (input.breakdownUrl ?? '').trim()
  const footer = url ? `Төлбөрийн задаргаа: ${url}` : ''

  const totalLine =
    Number.isFinite(input.total) && input.total > 0
      ? `Төлбөр: ${Math.round(input.total).toLocaleString('en-US')}₮`
      : ''

  const buildBody = (orgName: string, meterText: string) => {
    const parts = [`Нэр: ${orgName}`]
    if (meterText) parts.push(meterText)
    if (totalLine) parts.push(totalLine)
    if (footer) parts.push(footer)
    return parts.join('\n')
  }

  let meterText = sortedMeters.map(formatMeterLine).join('\n')
  let message = buildBody(orgRaw, meterText)

  const maxLen = 480
  if (message.length <= maxLen) return message

  if (sortedMeters.length > 3) {
    const lines = sortedMeters.slice(0, 3).map(formatMeterLine)
    const extra = sortedMeters.length - 3
    if (extra > 0) lines.push(`+${extra} тоолуур`)
    meterText = lines.join('\n')
    message = buildBody(truncateText(orgRaw, 48), meterText)
  }

  if (message.length > maxLen) {
    const orgShort = truncateText(input.organizationName, 32)
    meterText = sortedMeters.length > 0 ? `${sortedMeters.length} тоолуур` : ''
    message = buildBody(orgShort, meterText)
  }

  if (message.length > maxLen && footer) {
    const withoutFooter = buildBody(truncateText(orgRaw, 40), meterText)
    const room = maxLen - withoutFooter.length - 1
    if (room > 24) {
      message = `${withoutFooter}\n${truncateText(footer, room)}`
    } else {
      message = withoutFooter.slice(0, maxLen)
    }
  }

  return message.slice(0, maxLen)
}
