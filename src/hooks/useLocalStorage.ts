import { useEffect, useState } from 'react'

export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue
    try {
      const stored = window.localStorage.getItem(key)
      return stored ? (JSON.parse(stored) as T) : defaultValue
    } catch (error) {
      console.warn(`Unable to parse localStorage for key "${key}"`, error)
      return defaultValue
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.warn(`Unable to persist localStorage for key "${key}"`, error)
    }
  }, [key, value])

  return [value, setValue] as const
}
