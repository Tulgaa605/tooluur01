'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchWithAuth } from '@/lib/api'

type ProfileUser = {
  id: string
  email: string
  name: string
  role: string
  phoneMasked: string
  hasPhone: boolean
  birthDate: string | null
}

type VerifyStep = 'idle' | 'code_sent' | 'verified'

export default function ProfileContent() {
  const [profile, setProfile] = useState<ProfileUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifyStep, setVerifyStep] = useState<VerifyStep>('idle')
  const [otpSessionToken, setOtpSessionToken] = useState('')
  const [profileVerificationToken, setProfileVerificationToken] = useState('')
  const [linkPhone, setLinkPhone] = useState('')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const loadProfile = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth('/api/profile', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')
      const u = data.user as ProfileUser
      setProfile(u)
      setEmail(u.email || '')
      setBirthDate(u.birthDate || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Профайл ачаалахад алдаа гарлаа')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const handleSendCode = async () => {
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const body: Record<string, string> = {}
      if (otpSessionToken) body.otpSessionToken = otpSessionToken
      if (!profile?.hasPhone) {
        if (!linkPhone.trim()) {
          throw new Error('Утасны дугаар оруулна уу')
        }
        body.phone = linkPhone.trim()
      }

      const res = await fetchWithAuth('/api/profile/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Код илгээхэд алдаа гарлаа')
      if (data.otpSessionToken) setOtpSessionToken(data.otpSessionToken)
      setVerifyStep('code_sent')
      setCode('')
      if (data.devCode) {
        setInfo(`Хөгжүүлэлтийн горим: код — ${data.devCode}`)
      } else {
        setInfo(
          `6 оронтой код ${data.phoneMasked || 'таны утас'} руу 159099 дугаараас илгээгдлээ.`
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Код илгээхэд алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const res = await fetchWithAuth('/api/profile/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, otpSessionToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.otpSessionToken) setOtpSessionToken(data.otpSessionToken)
        throw new Error(data.error || 'Код буруу байна')
      }
      setProfileVerificationToken(data.profileVerificationToken)
      setVerifyStep('verified')
      if (data.phoneLinked && profile) {
        setProfile({
          ...profile,
          hasPhone: true,
          phoneMasked: data.phoneMasked || profile.phoneMasked,
        })
      }
      setInfo(
        data.phoneLinked
          ? 'Утас амжилттай бүртгэгдлээ. Одоо мэдээллээ засварлаж болно.'
          : 'Утас амжилттай баталгаажлаа. Одоо мэдээллээ засварлаж болно.'
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Код баталгаажуулахад алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profileVerificationToken) {
      setError('Эхлээд утасны дугаараа баталгаажуулна уу')
      return
    }
    if (password && password !== passwordConfirm) {
      setError('Нууц үг таарахгүй байна')
      return
    }
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const payload: Record<string, string | null> = {
        profileVerificationToken,
        email: email.trim(),
        birthDate: birthDate.trim() || null,
      }
      if (password) payload.password = password

      const res = await fetchWithAuth('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Хадгалахад алдаа гарлаа')

      if (data.user) {
        setProfile(data.user)
        setEmail(data.user.email || '')
        setBirthDate(data.user.birthDate || '')
      }
      setPassword('')
      setPasswordConfirm('')
      setInfo('Профайл амжилттай хадгалагдлаа')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Хадгалахад алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center px-4">
        <div className="text-gray-600">Ачааллаж байна...</div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex justify-center px-4">
        <p className="text-red-600">{error || 'Профайл олдсонгүй'}</p>
      </div>
    )
  }

  const roleLabel =
    profile.role === 'ACCOUNTANT'
      ? 'Нягтлан'
      : profile.role === 'MANAGER'
        ? 'Захирал'
        : 'Хэрэглэгч'

  const canEdit = verifyStep === 'verified' && Boolean(profileVerificationToken)

  return (
    <div className="flex justify-center px-4 sm:px-6">
      <div className="w-full max-w-lg">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2 text-center sm:text-left">
          Профайл
        </h2>
        <p className="text-sm text-gray-600 mb-6 text-center sm:text-left">
          {profile.name} · {roleLabel}
        </p>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            {info}
          </div>
        )}

        <section className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Утасны баталгаажуулалт</h3>
          {!profile.hasPhone ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Таны бүртгэлд утасны дугаар байхгүй байна. Утас оруулаад SMS кодоор баталгаажуулбал
                профайл засварлах боломжтой болно. Нэг дугаар зөвхөн нэг хэрэглэгчид хамаарна.
              </p>
              {verifyStep !== 'verified' && (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="profile-link-phone"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Утасны дугаар
                    </label>
                    <input
                      id="profile-link-phone"
                      type="tel"
                      inputMode="tel"
                      value={linkPhone}
                      onChange={(e) => setLinkPhone(e.target.value)}
                      disabled={verifyStep === 'code_sent'}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50 focus:border-primary-500 focus:ring-primary-500"
                      placeholder="99119911"
                    />
                  </div>
                  {verifyStep !== 'code_sent' && (
                    <button
                      type="button"
                      onClick={() => void handleSendCode()}
                      disabled={busy || !linkPhone.trim()}
                      className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {busy ? 'Илгээж байна...' : 'Баталгаажуулах код илгээх'}
                    </button>
                  )}
                  {verifyStep === 'code_sent' && (
                    <form onSubmit={handleVerifyCode} className="space-y-3">
                      <div>
                        <label
                          htmlFor="profile-otp"
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          6 оронтой код
                        </label>
                        <input
                          id="profile-otp"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                          placeholder="123456"
                          autoComplete="one-time-code"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={busy || code.length !== 6}
                          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                        >
                          {busy ? 'Шалгаж байна...' : 'Код баталгаажуулах'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSendCode()}
                          disabled={busy}
                          className="text-sm text-primary-600 hover:text-primary-700"
                        >
                          Код дахин илгээх
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Имэйл, нууц үг, төрсөн өдөр өөрчлөхийн өмнө бүртгэлтэй утас{' '}
                <span className="font-medium text-gray-900">{profile.phoneMasked}</span> руу{' '}
                <span className="font-medium">159099</span> дугаараас илгээсэн кодоор баталгаажуулна.
              </p>

              {verifyStep !== 'verified' && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => void handleSendCode()}
                    disabled={busy}
                    className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {busy ? 'Илгээж байна...' : 'Баталгаажуулах код илгээх'}
                  </button>

                  {verifyStep === 'code_sent' && (
                    <form onSubmit={handleVerifyCode} className="space-y-3">
                      <div>
                        <label
                          htmlFor="profile-otp"
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          6 оронтой код
                        </label>
                        <input
                          id="profile-otp"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                          placeholder="123456"
                          autoComplete="one-time-code"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={busy || code.length !== 6}
                          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                        >
                          {busy ? 'Шалгаж байна...' : 'Код баталгаажуулах'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSendCode()}
                          disabled={busy}
                          className="text-sm text-primary-600 hover:text-primary-700"
                        >
                          Код дахин илгээх
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

            </>
          )}

          {verifyStep === 'verified' && (
            <p className="text-sm text-green-700 font-medium">✓ Утас баталгаажсан</p>
          )}
        </section>

        <form
          onSubmit={handleSave}
          className="bg-white border border-gray-200 rounded-lg p-5 space-y-4"
        >
          <h3 className="text-sm font-medium text-gray-900">Мэдээлэл засах</h3>

          <div>
            <label htmlFor="profile-email" className="block text-sm font-medium text-gray-700 mb-1">
              Имэйл (Gmail)
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canEdit}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:border-primary-500 focus:ring-primary-500"
            />
          </div>

          <div>
            <label
              htmlFor="profile-password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Шинэ нууц үг
            </label>
            <input
              id="profile-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!canEdit}
              autoComplete="new-password"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:border-primary-500 focus:ring-primary-500"
              placeholder="Хоосон бол өөрчлөхгүй"
            />
          </div>

          <div>
            <label
              htmlFor="profile-password2"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Шинэ нууц үг давтах
            </label>
            <input
              id="profile-password2"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              disabled={!canEdit}
              autoComplete="new-password"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:border-primary-500 focus:ring-primary-500"
            />
          </div>

          <div>
            <label
              htmlFor="profile-birthdate"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Төрсөн өдөр
            </label>
            <input
              id="profile-birthdate"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              disabled={!canEdit}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:border-primary-500 focus:ring-primary-500"
            />
          </div>

          <button
            type="submit"
            disabled={!canEdit || busy}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? 'Хадгалж байна...' : 'Хадгалах'}
          </button>

          {!canEdit && (
            <p className="text-xs text-gray-500">
              Засварлахын тулд дээрх утасны баталгаажуулалтыг дуусгана уу.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
