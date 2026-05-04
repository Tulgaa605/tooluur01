export interface EbarimtIssueInput {
  amount: number
  customerName: string
  customerTin?: string | null
  description: string
  billNo: string
  districtCode?: string
  branchNo?: string
  posNo?: string
}

export interface EbarimtIssueResult {
  billId: string | null
  qrData: string | null
  lotteryCode: string | null
  raw: unknown
}

function normalizeString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 ? s : null
}

export async function issueEbarimtBill(input: EbarimtIssueInput): Promise<EbarimtIssueResult> {
  const apiUrl = normalizeString(process.env.EBARIMT_API_URL)
  if (!apiUrl) {
    throw new Error('EBARIMT_API_URL тохируулаагүй байна')
  }

  const apiKey = normalizeString(process.env.EBARIMT_API_KEY)
  const merchantTin = normalizeString(process.env.EBARIMT_MERCHANT_TIN)
  const districtCode = normalizeString(process.env.EBARIMT_DISTRICT_CODE) ?? input.districtCode ?? '01'
  const branchNo = normalizeString(process.env.EBARIMT_BRANCH_NO) ?? input.branchNo ?? '001'
  const posNo = normalizeString(process.env.EBARIMT_POS_NO) ?? input.posNo ?? '001'

  const payload = {
    merchantTin,
    districtCode,
    branchNo,
    posNo,
    billNo: input.billNo,
    customerType: 'B2C',
    customerTin: normalizeString(input.customerTin),
    customerName: input.customerName,
    amount: Number(input.amount) || 0,
    description: input.description,
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { rawText: text }
  }

  if (!res.ok) {
    const msg =
      normalizeString(data?.message) ??
      normalizeString(data?.error) ??
      `e-barimt API алдаа (${res.status})`
    throw new Error(msg)
  }

  const billId =
    normalizeString(data?.billId) ??
    normalizeString(data?.id) ??
    normalizeString(data?.result?.billId)
  const qrData =
    normalizeString(data?.qrData) ??
    normalizeString(data?.qr_code) ??
    normalizeString(data?.result?.qrData)
  const lotteryCode =
    normalizeString(data?.lotteryCode) ??
    normalizeString(data?.lottery) ??
    normalizeString(data?.result?.lotteryCode)

  return {
    billId,
    qrData,
    lotteryCode,
    raw: data,
  }
}
