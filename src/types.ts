export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Recipe {
  id: string
  name: string
  prepTime: string
  ingredients: string[]
  meal: MealType
  instructions: string
}

export type DayPlan = Record<MealType, string | null>

export type MealPlan = Record<string, DayPlan>

export interface RawImportedRecipe {
  name?: unknown
  prep_time?: unknown
  ingredients?: unknown
  meal?: unknown
  instructions?: unknown
}

export interface RecipeImportPayload {
  recipes: RawImportedRecipe[]
}

export interface ImportedRecipe {
  name: string
  prep_time: string
  ingredients: string[]
  meal: MealType
  instructions: string
}

export interface ShoppingListItem {
  ingredient: string
  quantity: number
  unit?: string
}
