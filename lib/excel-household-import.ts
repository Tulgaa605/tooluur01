import * as XLSX from 'xlsx'

export type HouseholdExcelRow = {
  ovog: string
  givenName: string
  code: string
  address: string
  phone: string
  email: string
  connectionNumber: string
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

function rowLooksEmpty(r: HouseholdExcelRow): boolean {
  return (
    !r.ovog &&
    !r.givenName &&
    !r.code &&
    !r.address &&
    !r.phone &&
    !r.email &&
    !r.connectionNumber
  )
}

/** Эхний sheet-ээс мөрүүд уншина (1-р мөр = толгой хэсэг). */
export function parseHouseholdRowsFromExcel(buf: ArrayBuffer): HouseholdExcelRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return []
  const sheet = wb.Sheets[name]
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: HouseholdExcelRow[] = []
  for (const raw of json) {
    const ovog = cell(raw, ['Овог', 'ovog', 'фамилия'])
    const givenName = cell(raw, ['Нэр', 'name', 'нер', 'givenname'])
    const code = cell(raw, ['Код', 'code', 'Хэрэглэгчийн код', 'хэрэглэгчийнкод'])
    const address = cell(raw, ['Хаяг', 'address'])
    const phone = cell(raw, ['Утас', 'phone', 'утасны дугаар', 'утасныдугаар', 'mobile'])
    const email = cell(raw, ['Имэйл', 'email', 'e-mail', 'mail'])
    const connectionNumber = cell(raw, [
      'Шугамын хоолой',
      'connectionNumber',
      'голч',
      'diameter',
      'шугам',
      'connection',
    ])
    const r: HouseholdExcelRow = {
      ovog,
      givenName,
      code,
      address,
      phone,
      email,
      connectionNumber: connectionNumber || '15',
    }
    if (rowLooksEmpty(r)) continue
    out.push(r)
  }
  return out
}

export function downloadHouseholdExcelTemplate(filename = 'herglechdiin-jishee.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Овог', 'Нэр', 'Код', 'Хаяг', 'Утас', 'Имэйл', 'Шугамын хоолой'],
    ['Бат', 'Дорж', 'H-001', 'Жишээ хаяг', '99112233', 'dorj@example.com', '15'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Хэрэглэгчид')
  XLSX.writeFile(wb, filename)
}
