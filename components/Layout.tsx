'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

interface User {
  email: string
  role: string
  name: string
}

const menuItems = [
  { path: '/dashboard', label: 'Хяналтын самбар', roles: ['ACCOUNTANT', 'MANAGER', 'USER'] },
  { path: '/meters', label: 'Тоолуурууд', roles: ['ACCOUNTANT', 'MANAGER'] },
  { path: '/readings', label: 'Сарын заалт', roles: ['ACCOUNTANT'] },
  { path: '/tariffs', label: 'Тариф', roles: ['ACCOUNTANT', 'MANAGER'] },
  { path: '/billing', label: 'Төлбөр', roles: ['ACCOUNTANT', 'USER'] },
  { path: '/reports', label: 'Тайлан', roles: ['MANAGER'] },
  { path: '/users', label: 'Хэрэглэгчид', roles: ['ACCOUNTANT'] },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setUser(data.user)
        } else {
          router.push('/login')
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false))
  }, [router])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Ачааллаж байна...</div>
      </div>
    )
  }

  if (!user) return null

  const filteredMenu = menuItems.filter(item => 
    item.roles.includes(user.role)
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-semibold text-gray-900">
                  Усны тоолуурын систем
                </h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {filteredMenu.map((item) => (
                  <a
                    key={item.path}
                    href={item.path}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      pathname === item.path
                        ? 'border-primary-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{user.name}</span>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                {user.role === 'ACCOUNTANT' ? 'Нягтлан' : 
                 user.role === 'MANAGER' ? 'Захирал' : 'Хэрэглэгч'}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Гарах
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}