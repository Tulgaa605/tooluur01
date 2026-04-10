/**
 * Production build-ийн өмнө .next-build доторх types + dev stub-уудыг цэвэрлэнэ.
 * `dev/types` нь `route.js` stub-тай үлдэж TypeScript build унадаг тул dev-ийг бүхэлд нь устгана.
 */
const fs = require('fs')
const path = require('path')

function rmWithRetry(dir) {
  if (!fs.existsSync(dir)) return
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 12,
    retryDelay: 150,
  })
}

const root = process.cwd()
try {
  rmWithRetry(path.join(root, '.next-build', 'types'))
  rmWithRetry(path.join(root, '.next-build', 'dev'))
} catch (e) {
  console.warn('[clean-next-build-types]', e.message)
}
