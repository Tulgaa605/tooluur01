/**
 * Windows дээр Next.js dev эхлэхэд .next-build/dev доторх хэсэгчлэн устгал ENOTEMPTY өгдөг тул
 * dev cache-ийг бүрэн цэвэрлэнэ (maxRetries нь түгжээ тайлагдахыг хүлээнэ).
 */
const fs = require('fs')
const path = require('path')

const devDir = path.join(process.cwd(), '.next-build', 'dev')
try {
  if (fs.existsSync(devDir)) {
    fs.rmSync(devDir, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 150,
    })
  }
} catch (e) {
  console.warn('[clean-next-dev]', e.message)
}
