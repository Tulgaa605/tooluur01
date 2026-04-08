import * as XLSX from 'xlsx'

export type OrgExcelRow = {
  name: string
  code: string
  address: string
  phone: string
  email: string
  connectionNumber: string
  category: string
  year: string
}

function normKey(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function cell(row: Record<string, unknown>, labels: string[]): string {
  const entries = Object.entries(row)
  for (const label of labels) {
    const nl = normKey(label)
    for (const [hk, val] of entries) {
      const nk = normKey(hk)
      if (!nk) continue
      if (nk === nl || nk.includes(nl) || nl.includes(nk)) {
        if (val == null || val === '') return ''
        return String(val).trim()
      }
    }
  }
  return ''
}

function rowLooksEmpty(r: OrgExcelRow): boolean {
  return (
    !r.name &&
    !r.code &&
    !r.address &&
    !r.phone &&
    !r.email &&
    !r.connectionNumber &&
    !r.category
  )
}

/** Эхний sheet-ээс мөрүүд уншина (1-р мөр = толгой хэсэг). */
export function parseOrgRowsFromExcel(buf: ArrayBuffer): OrgExcelRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return []
  const sheet = wb.Sheets[name]
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: OrgExcelRow[] = []
  for (const raw of json) {
    const r: OrgExcelRow = {
      name: cell(raw, ['Нэр', 'name']),
      code: cell(raw, ['Код', 'code', 'Хэрэглэгчийн код', 'хэрэглэгчийнкод']),
      address: cell(raw, ['Хаяг', 'address']),
      phone: cell(raw, ['Утас', 'phone', 'утасны дугаар', 'утасныдугаар', 'mobile']),
      email: cell(raw, ['Имэйл', 'email', 'e-mail', 'mail']),
      connectionNumber: cell(raw, ['Шугамын хоолой', 'connectionNumber', 'голч', 'diameter']),
      category: cell(raw, ['Төрөл', 'Хэрэглэгчийн төрөл', 'category']),
      year: cell(raw, ['Он', 'year']),
    }
    if (rowLooksEmpty(r)) continue
    out.push(r)
  }
  return out
}

export function downloadOrgExcelTemplate(filename = 'baiguullaga-jishee.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Нэр', 'Код', 'Хаяг', 'Утас', 'Имэйл', 'Шугамын хоолой', 'Хэрэглэгчийн төрөл', 'Он'],
    ['Жишээ байгууллага', 'B-001', 'Жишээ хаяг', '99112233', 'org@example.com', '15', 'BUSINESS', String(new Date().getFullYear())],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Байгууллага')
  XLSX.writeFile(wb, filename)
}

