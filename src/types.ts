export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Recipe {
  id: string
  name: string
  prepTime: string
  ingredients: string[]
  meal: MealType
  servings: number
  instructions: string
}

export type DayPlan = Record<MealType, string | null>

export type MealPlan = Record<string, DayPlan>

export interface RawImportedRecipe {
  name?: unknown
  prep_time?: unknown
  'prep time'?: unknown
  prepTime?: unknown
  ingredients?: unknown
  meal?: unknown
  'meal type'?: unknown
  meal_type?: unknown
  course?: unknown
  category?: unknown
  servings?: unknown
  instructions?: unknown
  instruction?: unknown
  directions?: unknown
  method?: unknown
}

export interface RecipeImportPayload {
  recipes: RawImportedRecipe[]
}

export interface ImportedRecipe {
  name: string
  prep_time: string
  ingredients: string[]
  meal: MealType
  servings: number
  instructions: string
}

export interface ShoppingListItem {
  ingredient: string
  quantity: number
  unit?: string
}
