import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/middleware'

import { Role } from '@/lib/role'

import { loadMonthlyAccountingMeterRows } from '@/lib/load-monthly-accounting-report'

import {

  buildMonthlyAccountingTableView,

  monthlyAccountingReportToBuffer,

} from '@/lib/monthly-accounting-report-excel'



export async function GET(request: NextRequest) {

  try {

    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })



    const { searchParams } = new URL(request.url)

    const year = parseInt(searchParams.get('year') ?? '', 10)

    const month = parseInt(searchParams.get('month') ?? '', 10)

    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {

      return NextResponse.json(

        { error: 'year, month (1–12) шаардлагатай' },

        { status: 400 }

      )

    }



    const meterRows = await loadMonthlyAccountingMeterRows(user, year, month)



    if (searchParams.get('format') === 'json') {

      return NextResponse.json(buildMonthlyAccountingTableView(year, month, meterRows))

    }



    const buf = await monthlyAccountingReportToBuffer(year, month, meterRows)

    const monthPad = String(month).padStart(2, '0')

    const utf8Filename = `Тайлан-${year}-${monthPad}.xlsx`

    const asciiFilename = `Tailan-${year}-${monthPad}.xlsx`

    const contentDisposition = `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`



    return new NextResponse(new Uint8Array(buf), {

      status: 200,

      headers: {

        'Content-Type':

          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

        'Content-Disposition': contentDisposition,

      },

    })

  } catch (e: unknown) {

    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'

    if (msg === 'Unauthorized' || msg === 'Forbidden') {

      return NextResponse.json({ error: msg }, { status: 403 })

    }

    return NextResponse.json({ error: msg }, { status: 500 })

  }

}


