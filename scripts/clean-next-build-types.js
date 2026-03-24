/**
 * Windows дээр production build үед .next-build/types цэвэрлэгээ ENOTEMPTY алдаа өгөхөөс сэргийлнэ.
 * Зөвхөн types хавтсыг retry-тэй устгана.
 */
const fs = require('fs')
const path = require('path')

const typesDir = path.join(process.cwd(), '.next-build', 'types')
try {
  if (fs.existsSync(typesDir)) {
    fs.rmSync(typesDir, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 150,
    })
  }
} catch (e) {
  console.warn('[clean-next-build-types]', e.message)
}
