/**
 * Production build-ийн өмнө .next-build доторх types stub-уудыг цэвэрлэнэ.
 * Зөвхөн types хавтсыг устгана — бүтэн dev/ устгавал ажиллаж буй `next dev` webpack cache эвдэрнэ.
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
  rmWithRetry(path.join(root, '.next-build', 'dev', 'types'))
} catch (e) {
  console.warn('[clean-next-build-types]', e.message)
}
