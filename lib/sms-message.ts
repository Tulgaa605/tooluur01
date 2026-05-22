const SMS_MAX_LEN = 159

export type MeterUsageSmsLine = { meterNumber: string; usage: number; usageLabel?: string }

function formatUsageM3(usage: number): string {
  const n = Number(usage)
  if (!Number.isFinite(n) || n < 0) return '0.00'
  return n.toFixed(2)
}

/** Нэр, тоолуур бүрт усны хэрэглээ, доор төлбөрийн задаргааны холбоос */
export function buildSmsMessage(input: {
  organizationName: string
  organizationCode?: string | null
  meterLines: MeterUsageSmsLine[]
  total: number
  breakdownUrl?: string | null
}): string {
  const org = `${input.organizationName}${input.organizationCode ? ` (${input.organizationCode})` : ''}`
  const nameLine = `Нэр: ${org}`

  const meterParts = [...input.meterLines]
    .filter((m) => String(m.meterNumber ?? '').trim())
    .sort((a, b) => String(a.meterNumber).localeCompare(String(b.meterNumber), 'mn'))
    .map((m) => {
      const num = String(m.meterNumber).trim()
      if (m.usageLabel) return `${num}: ${m.usageLabel}`
      return `${num}: ${formatUsageM3(m.usage)}м³`
    })

  const totalLine =
    Number.isFinite(input.total) && input.total > 0
      ? `Нийт: ${Math.round(input.total).toLocaleString('en-US')}₮`
      : ''

  const footer = input.breakdownUrl ? `Төлбөрийн задаргаа: ${input.breakdownUrl}` : ''

  const segments = [nameLine, ...meterParts]
  if (totalLine) segments.push(totalLine)
  if (footer) segments.push(footer)

  let full = segments.join(' ')
  if (full.length <= SMS_MAX_LEN) return full

  if (footer) {
    const footerWithSpace = ` ${footer}`
    let room = SMS_MAX_LEN - footerWithSpace.length
    if (room < 8) return footer.slice(0, SMS_MAX_LEN)

    const head: string[] = [nameLine]
    for (const part of meterParts) {
      const candidate = [...head, part].join(' ')
      if (candidate.length <= room) head.push(part)
      else break
    }

    let body = head.join(' ')
    if (meterParts.length > 0 && head.length <= 1) {
      body = `${nameLine} ${meterParts.length} тоолуур`
      if (body.length > room) body = `${nameLine.slice(0, Math.max(0, room - 3))}...`
    } else if (totalLine && body.length + totalLine.length + 1 <= room) {
      body = `${body} ${totalLine}`
    }

    return `${body}${footerWithSpace}`.slice(0, SMS_MAX_LEN)
  }

  return full.slice(0, SMS_MAX_LEN)
}
