/**
 * next build. NODE_OPTIONS=8192 нь webpack worker бүр 8GB нөөцөлж
 * бага RAM Windows серверийг "Fatal process out of memory: Zone" гэж унагадаг.
 */
const { spawnSync } = require('child_process')
const os = require('os')

const totalMb = Math.round(os.totalmem() / 1024 / 1024)
const heapMb = Math.min(2048, Math.max(1024, totalMb - 2048))

const env = { ...process.env }
env.NODE_OPTIONS = `--max-old-space-size=${heapMb}`
env.LOW_MEM_BUILD = '1'
env.NEXT_TELEMETRY_DISABLED = env.NEXT_TELEMETRY_DISABLED || '1'

console.log(
  `[next-build] RAM ~${totalMb}MB, heap ${heapMb}MB, webpack workers=1 (NODE_OPTIONS=8192 хэрэглэхгүй)`
)

const result = spawnSync('npx', ['next', 'build', '--webpack'], {
  stdio: 'inherit',
  env,
  shell: true,
})

process.exit(result.status == null ? 1 : result.status)
