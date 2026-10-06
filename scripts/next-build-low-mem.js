/**
 * next build: heap-ийг машины RAM-д тааруулна.
 * 2GB cap нь 24GB сервер дээр webpack compile-ийг Zone OOM-оор унагадаг.
 */
const { spawnSync } = require('child_process')
const os = require('os')

const totalMb = Math.round(os.totalmem() / 1024 / 1024)
const lowMem = totalMb < 12 * 1024

let heapMb
if (totalMb >= 16 * 1024) {
  heapMb = 8192
} else if (totalMb >= 12 * 1024) {
  heapMb = 6144
} else if (totalMb >= 8 * 1024) {
  heapMb = 4096
} else {
  heapMb = 2048
}

const env = { ...process.env }
env.NODE_OPTIONS = `--max-old-space-size=${heapMb}`
if (lowMem) {
  env.LOW_MEM_BUILD = '1'
} else {
  delete env.LOW_MEM_BUILD
}
env.NEXT_TELEMETRY_DISABLED = env.NEXT_TELEMETRY_DISABLED || '1'

console.log(
  `[next-build] RAM ~${totalMb}MB, heap ${heapMb}MB${lowMem ? ', low-mem webpack' : ''}`
)

const result = spawnSync('npx', ['next', 'build', '--webpack'], {
  stdio: 'inherit',
  env,
  shell: true,
})

process.exit(result.status == null ? 1 : result.status)
