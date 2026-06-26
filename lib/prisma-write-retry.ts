function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isPrismaWriteConflict(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '')
    if (code === 'P2034' || code === 'P2028') return true
  }
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /write conflict|deadlock|Transaction failed/i.test(msg)
}

/** MongoDB Atlas зэрэгцээ бичилтэд write conflict гарвал дахин оролдоно. */
export async function withPrismaWriteRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 5
  const baseDelayMs = options?.baseDelayMs ?? 40
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isPrismaWriteConflict(error) || attempt === maxAttempts) {
        throw error
      }
      await sleep(baseDelayMs * attempt + Math.floor(Math.random() * 25))
    }
  }

  throw lastError
}
