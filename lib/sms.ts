export type SmsSendResult = { to: string; ok: boolean; error?: string }

export function normalizeToE164MN(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('+')) {
    const rest = cleaned.slice(1).replace(/\D/g, '')
    if (rest.length < 8) return null
    return `+${rest}`
  }
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length === 8 && /^[6-9]/.test(digits)) return `+976${digits}`
  if (digits.length === 11 && digits.startsWith('976')) return `+${digits}`
  return null
}

function detectMode(): 'unitel' | 'http' | 'none' {
  if (process.env.UNITEL_SMS_ENC?.trim()) return 'unitel'
  if (process.env.SMS_HTTP_URL?.trim()) return 'http'
  return 'none'
}

/** Unitel API: олон төлбөртэй 8 оронтой дотоод дугаар эсвэл 976+8. */
function toUnitelPhoneParam(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.length >= 11 && d.startsWith('976')) return d.slice(3)
  if (d.length === 8) return d
  return d
}

async function sendUnitel(toE164: string, message: string): Promise<void> {
  const enc = process.env.UNITEL_SMS_ENC!.trim()
  const to = toUnitelPhoneParam(toE164)
  if (!to) throw new Error('Буруу утасны дугаар')

  const url = `https://pn.unitel.mn/api/message/send/sms?enc=${encodeURIComponent(enc)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[SMS][unitel] fetch failed', { to, error: msg })
    throw new Error(`Unitel fetch: ${msg}`)
  }

  const raw = await res.text()
  // Серверийн логонд бодит хариуг үлдээнэ — тохиргооны асуудлыг хурдан илрүүлэхийн тулд.
  console.log('[SMS][unitel] response', {
    to,
    status: res.status,
    bodyPreview: raw.slice(0, 300),
  })
  if (!res.ok) {
    throw new Error(`Unitel SMS ${res.status}: ${raw.slice(0, 300) || 'хариу хоосон'}`)
  }
  const t = raw.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return
  try {
    const j = JSON.parse(t) as {
      success?: boolean
      status?: string
      error?: string
      message?: string
      code?: number | string
      desc?: string
      result?: string
    }
    const statusStr = String(j.status ?? j.result ?? '').toLowerCase()
    const isFailure =
      j.success === false ||
      statusStr === 'error' ||
      statusStr === 'fail' ||
      statusStr === 'failed' ||
      (j.code != null && String(j.code) !== '0' && String(j.code) !== '200')
    if (isFailure) {
      const errMsg =
        j.error || j.desc || j.message || `Unitel: ${statusStr || 'амжилтгүй'} (code ${j.code ?? '-'})`
      throw new Error(errMsg)
    }
  } catch (e) {
    if (e instanceof SyntaxError) return
    throw e
  }
}

async function sendHttp(to: string, body: string, senderLabel: string): Promise<void> {
  const url = process.env.SMS_HTTP_URL!.trim()
  const bearer = process.env.SMS_HTTP_BEARER_TOKEN?.trim()
  const phoneKey = process.env.SMS_HTTP_PHONE_FIELD?.trim() || 'phone'
  const messageKey = process.env.SMS_HTTP_MESSAGE_FIELD?.trim() || 'message'
  const senderKey = process.env.SMS_HTTP_SENDER_FIELD?.trim() || 'sender'

  const payload: Record<string, string> = {
    [phoneKey]: to,
    [messageKey]: body,
    [senderKey]: senderLabel,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (bearer) headers.Authorization = `Bearer ${bearer}`

  const extra = process.env.SMS_HTTP_HEADERS_JSON?.trim()
  if (extra) {
    try {
      const parsed = JSON.parse(extra) as Record<string, string>
      Object.assign(headers, parsed)
    } catch {
      /* ignore invalid JSON */
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(errText.slice(0, 500) || `SMS HTTP ${res.status}`)
  }
}

/**
 * Давхардсан дугаарыг хасаж, бүх хүлээн авагчид SMS илгээнэ.
 */
export async function sendTextSms(
  rawPhones: string[],
  text: string,
  senderLabel: string
): Promise<{ enabled: boolean; mode: 'unitel' | 'http' | 'none'; results: SmsSendResult[] }> {
  const body = String(text ?? '').trim()
  const mode = detectMode()
  const unique = new Map<string, string>()
  for (const raw of rawPhones) {
    const e164 = normalizeToE164MN(raw)
    if (e164 && !unique.has(e164)) unique.set(e164, raw)
  }
  const targets = [...unique.keys()]

  if (mode === 'none') {
    return {
      enabled: false,
      mode: 'none',
      results: targets.map((to) => ({
        to,
        ok: false,
        error: 'UNITEL_SMS_ENC эсвэл SMS_HTTP_URL .env дээр тохируулаагүй байна',
      })),
    }
  }

  if (!body) {
    return {
      enabled: true,
      mode,
      results: targets.map((to) => ({ to, ok: false, error: 'SMS текст хоосон' })),
    }
  }

  const results: SmsSendResult[] = []
  for (const to of targets) {
    try {
      if (mode === 'unitel') {
        await sendUnitel(to, body)
      } else {
        await sendHttp(to, body, senderLabel)
      }
      results.push({ to, ok: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ to, ok: false, error: msg })
    }
  }

  return { enabled: true, mode, results }
}
