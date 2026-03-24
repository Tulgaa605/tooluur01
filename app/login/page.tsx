'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
        throw new Error(data.error || 'Нэвтрэхэд алдаа гарлаа')
      }

      if (data.token && typeof window !== 'undefined') {
        sessionStorage.setItem('token', data.token)
      }

      setTimeout(() => {
        window.location.replace('/dashboard')
      }, 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нэвтрэхэд алдаа гарлаа')
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
            Нэвтрэх
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          <div className="space-y-4">
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          <div className="space-y-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              {loading ? 'Нэвтэрч байна...' : 'Нэвтрэх'}
            </button>
            <p className="text-center text-sm text-gray-600">
              Бүртгэл байхгүй юу?{' '}
              <Link
                href="/register"
                className="font-medium text-primary-600 hover:text-primary-500"
              >
                Бүртгүүлэх
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
