/** Client-side: sessionStorage-аас token аваад API дуудлагад Authorization header нэмнэ */
export function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = sessionStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** fetch-ийг auth header + credentials-тэй дуудна (нэвтрэлт ажиллана) */
export function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const auth = getAuthHeaders()
  Object.entries(auth).forEach(([k, v]) => headers.set(k, v))
  return fetch(input, { ...init, credentials: 'include', headers })
}
