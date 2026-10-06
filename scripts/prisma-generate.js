/**
 * prisma generate. Windows сервер дээр RAM дутахад VirtualAlloc унадаг.
 * Клиент аль хэдийн байвал generate амжилтгүй болсон ч build үргэлжилнэ.
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const clientJs = path.join(process.cwd(), 'lib', 'prisma-generated', 'index.js')
const env = { ...process.env }
if (!env.NODE_OPTIONS) {
  env.NODE_OPTIONS = '--max-old-space-size=2048'
}

const result = spawnSync('npx', ['prisma', 'generate'], {
  stdio: 'inherit',
  env,
  shell: true,
})

if (result.status === 0) {
  process.exit(0)
}

if (fs.existsSync(clientJs)) {
  console.warn(
    '[prisma-generate] generate амжилтгүй (ихэвчлэн RAM/VirtualAlloc). Одоо байгаа lib/prisma-generated ашиглана.'
  )
  process.exit(0)
}

console.error(
  '[prisma-generate] generate амжилтгүй, Prisma клиент алга. PM2/Node процессыг зогсоогоод RAM/pagefile нэмээд дахин оролдоно уу.'
)
process.exit(result.status == null ? 1 : result.status)
