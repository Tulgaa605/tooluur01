'use client'

import { useState } from 'react'
import Link from 'next/link'

type Step = 'phone' | 'verify' | 'details'

export default function RegisterPage() {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otpSessionToken, setOtpSessionToken] = useState('')
  const [verifiedPhone, setVerifiedPhone] = useState('')
  const [phoneVerificationToken, setPhoneVerificationToken] = useState('')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const parseError = async (res: Response) => {
    const text = await res.text()
    try {
      const data = text ? JSON.parse(text) : {}
      return data.error || 'Алдаа гарлаа'
    } catch {
      return res.ok ? 'Алдаа гарлаа' : 'Серверийн алдаа. Дахин оролдоно уу.'
    }
  }

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otpSessionToken: otpSessionToken || undefined }),
      })

      if (!res.ok) {
        throw new Error(await parseError(res))
      }

      const data = await res.json()
      setPhone(data.phone || phone)
      if (data.otpSessionToken) setOtpSessionToken(data.otpSessionToken)
      setCode('')
      setStep('verify')
      if (data.devCode) {
        setInfo(`Хөгжүүлэлтийн горим: код — ${data.devCode}`)
      } else {
        setInfo('6 оронтой код таны утас руу илгээгдлээ.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Код илгээхэд алдаа гарлаа')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, otpSessionToken }),
      })

      const data = await res.json()
      if (!res.ok) {
        if (data.otpSessionToken) setOtpSessionToken(data.otpSessionToken)
        throw new Error(data.error || 'Код баталгаажуулахад алдаа гарлаа')
      }

      setVerifiedPhone(data.phone)
      setPhoneVerificationToken(data.phoneVerificationToken)
      setStep('details')
      setInfo('Утасны дугаар амжилттай баталгаажлаа. Бүртгэлийн мэдээллээ оруулна уу.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Код баталгаажуулахад алдаа гарлаа')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          name,
          phone: verifiedPhone,
          phoneVerificationToken,
        }),
        credentials: 'include',
      })

      const text = await res.text()
      let data: { error?: string; token?: string } = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        if (!res.ok) {
          setError('Серверийн алдаа. Дахин оролдоно уу.')
          return
        }
      }

      if (!res.ok) {
        throw new Error(data.error || 'Бүртгэлд алдаа гарлаа')
      }

      const token = data.token
      if (token && typeof window !== 'undefined') {
        sessionStorage.setItem('token', token)
      }

      setTimeout(() => {
        window.location.replace('/dashboard')
      }, 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Бүртгэлд алдаа гарлаа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-sm border border-gray-200">
        <div>
          <h2 className="text-center text-3xl font-semibold text-gray-900">
            Усны тоолуурын систем
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {step === 'phone' && 'Утасны дугаараа баталгаажуулна уу'}
            {step === 'verify' && 'Илгээсэн кодоо оруулна уу'}
            {step === 'details' && 'Бүртгэлийн мэдээлэл оруулна уу'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        {info && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {info}
          </div>
        )}

        {step === 'phone' && (
          <form className="mt-8 space-y-6" onSubmit={handleSendCode}>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                Утасны дугаар
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel"
                placeholder="99112233"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div className="space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {loading ? 'Илгээж байна...' : 'Код илгээх'}
              </button>
              <Link
                href="/login"
                className="w-full flex justify-center py-2.5 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Нэвтрэх
              </Link>
            </div>
          </form>
        )}

        {step === 'verify' && (
          <form className="mt-8 space-y-6" onSubmit={handleVerifyCode}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Утасны дугаар</label>
                <p className="mt-1 text-sm text-gray-900">{phone}</p>
              </div>
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                  Баталгаажуулах код
                </label>
                <input
                  id="code"
                  name="code"
                  type="text"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm tracking-widest text-center text-lg focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
            <div className="space-y-3">
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {loading ? 'Шалгаж байна...' : 'Баталгаажуулах'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setStep('phone')
                  setOtpSessionToken('')
                  setError('')
                  setInfo('')
                }}
                className="w-full flex justify-center py-2.5 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Дугаар солих
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={(e) => handleSendCode(e as unknown as React.FormEvent)}
                className="w-full flex justify-center py-2 text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
              >
                Код дахин илгээх
              </button>
            </div>
          </form>
        )}

        {step === 'details' && (
          <form className="mt-8 space-y-6" onSubmit={handleRegister}>
            <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700">
              Баталгаажсан утас: <span className="font-medium">{verifiedPhone}</span>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Нэр
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Имэйл
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Нууц үг
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="mt-1 text-xs text-gray-500">Хамгийн багадаа 6 тэмдэгт</p>
              </div>
            </div>
            <div className="space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {loading ? 'Бүртгэж байна...' : 'Бүртгүүлэх'}
              </button>
              <Link
                href="/login"
                className="w-full flex justify-center py-2.5 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Нэвтрэх
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
