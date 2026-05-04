/**
 * Илгээгчийн богино дугаар / үйлчилгээний дугаарууд (.env-аас).
 * Жишээ: SMS_SENDER_IDS=139898,89980862,899899
 */

export function parseSmsSenderIds(): string[] {
  const raw = process.env.SMS_SENDER_IDS?.trim()
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ]
}

export function getDefaultSmsSender(): string {
  const explicit = process.env.SMS_SENDER_NUMBER?.trim()
  if (explicit) return explicit
  const ids = parseSmsSenderIds()
  return ids[0] || '89980862'
}

/**
 * Илгээх SMS-д ашиглах илгээгчийн дугаар.
 * `.env`-ийн `SMS_SENDER_NUMBER` заавал байвал түүнийг эхэлж ашиглана (тусгай үйлчилгээний дугаар).
 * Үгүй бол хүсэлтийн `fromPhone`, эсвэл `getDefaultSmsSender()`.
 */
export function resolveEffectiveSmsSender(clientFromBody: string | undefined): string {
  const envSender = process.env.SMS_SENDER_NUMBER?.trim()
  if (envSender) return envSender
  const client =
    typeof clientFromBody === 'string' && clientFromBody.trim()
      ? clientFromBody.trim()
      : ''
  if (client) return client
  return getDefaultSmsSender()
}

/** Сонголтонд гаргах жагсаалт (хоосон бол нэг анхдагч). */
export function getSmsSenderChoices(): string[] {
  const ids = parseSmsSenderIds()
  const extra = process.env.SMS_SENDER_NUMBER?.trim()
  const set = new Set<string>()
  ids.forEach((s) => set.add(s))
  if (extra) set.add(extra)
  const arr = [...set]
  if (arr.length > 0) return arr.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return ['89980862']
}
