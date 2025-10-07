import type { DayPlan, MealPlan, MealType, Recipe } from './types'

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export function createEmptyDayPlan(): DayPlan {
  return MEAL_TYPES.reduce(
    (acc, meal) => {
      acc[meal] = null
      return acc
    },
    {} as DayPlan,
  )
}

export function ensureDayPlan(plan: MealPlan, date: string) {
  if (!plan[date]) {
    plan[date] = createEmptyDayPlan()
  }
}

export function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function formatDateRangeDisplay(start: string, end: string) {
  if (!start || !end) return ''
  const [startYear, startMonth, startDay] = start.split('-')
  const [endYear, endMonth, endDay] = end.split('-')
  return `${startDay}/${startMonth}/${startYear}–${endDay}/${endMonth}/${endYear}`
}

export function formatDateLabel(dateString: string) {
  const date = new Date(dateString + 'T12:00:00')
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

export function generateId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizeIngredient(raw: string) {
  return raw.trim().toLowerCase()
}

export function dedupeRecipes(existing: Recipe[], incoming: Recipe[]) {
  const seen = new Map(existing.map((recipe) => [recipe.name.toLowerCase(), recipe]))
  const merged = [...existing]

  incoming.forEach((recipe) => {
    const key = recipe.name.toLowerCase()
    if (seen.has(key)) {
      const existingRecipe = seen.get(key)!
      // Update existing recipe fields with incoming data
      Object.assign(existingRecipe, recipe)
    } else {
      merged.push(recipe)
      seen.set(key, recipe)
    }
  })

  return merged
}

export function toDateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

export function addDays(dateString: string, days: number) {
  const date = new Date(dateString + 'T00:00:00')
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

export function weekDates(anchor: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(anchor, index))
}

export function dateRangeInclusive(start: string, end: string) {
  const dates: string[] = []
  if (!start || !end) return dates

  const startDate = new Date(start + 'T00:00:00')
  const endDate = new Date(end + 'T00:00:00')
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return dates
  if (startDate > endDate) return dates

  let cursor = startDate
  while (cursor <= endDate) {
    dates.push(toDateInputValue(cursor))
    cursor = new Date(cursor.getTime())
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

const FRACTIONS: Record<string, number> = {
  '1/2': 0.5,
  '1/3': 0.333,
  '2/3': 0.666,
  '1/4': 0.25,
  '3/4': 0.75,
  '1/8': 0.125,
}

const KNOWN_UNITS = [
  'g',
  'kg',
  'mg',
  'oz',
  'lb',
  'lbs',
  'ml',
  'l',
  'cup',
  'cups',
  'tsp',
  'tbsp',
  'clove',
  'cloves',
  'slice',
  'slices',
  'piece',
  'pieces',
  'can',
  'cans',
  'packet',
  'packets',
  'bunch',
  'bunches',
] as const

const KNOWN_UNIT_SET = new Set<string>(KNOWN_UNITS)

export interface ParsedIngredient {
  raw: string
  quantity: number | null
  unit?: string
  item: string
}

export function parseIngredientDetails(raw: string): ParsedIngredient {
  const trimmed = raw.trim()
  const parts = trimmed.split(/\s+/)
  let quantity: number | null = null
  let unit: string | undefined
  let startIndex = 0

  if (parts.length) {
    const first = parts[0]
    const cleanFirst = first.replace(/[()]/g, '')
    if (/^\d+$/.test(cleanFirst)) {
      quantity = Number.parseFloat(cleanFirst)
      startIndex = 1
    } else if (/^\d+[./]\d+$/.test(cleanFirst)) {
      quantity = FRACTIONS[cleanFirst] ?? evaluateFraction(cleanFirst)
      startIndex = 1
    } else if (/^\d+\.\d+$/.test(cleanFirst)) {
      quantity = Number.parseFloat(cleanFirst)
      startIndex = 1
    }
  }

  const unitCandidate = parts[startIndex]?.toLowerCase()
  if (unitCandidate && KNOWN_UNIT_SET.has(unitCandidate)) {
    unit = unitCandidate
    startIndex += 1
  }

  const item = parts.slice(startIndex).join(' ') || trimmed

  return {
    raw: trimmed,
    quantity,
    unit,
    item: item.toLowerCase(),
  }
}

function evaluateFraction(expression: string) {
  const [numerator, denominator] = expression.split('/')
  const num = Number.parseFloat(numerator)
  const den = Number.parseFloat(denominator)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  return num / den
}
