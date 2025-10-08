import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { useLocalStorage } from './hooks/useLocalStorage'
import type {
  DayPlan,
  MealPlan,
  MealType,
  Recipe,
  ImportedRecipe,
  RecipeImportPayload,
  RawImportedRecipe,
  ShoppingListItem,
} from './types'
import {
  MEAL_TYPES,
  addDays,
  dateRangeInclusive,
  dedupeRecipes,
  ensureDayPlan,
  formatDateLabel,
  formatDateRangeDisplay,
  generateId,
  parseIngredientDetails,
  toDateInputValue,
  weekDates,
} from './utils'
import cookbookSeed from './assets/vanlifecookbook.json'

type ViewKey = 'planner' | 'overview' | 'recipes'
type RecipeDraftInput = Omit<Recipe, 'id'>

interface DayItinerary {
  date: string
  meals: Array<{ meal: MealType; recipe: Recipe }>
}

interface PlanOutputs {
  shoppingList: ShoppingListItem[]
  itinerary: DayItinerary[]
  recipes: Recipe[]
  plannedMeals: number
}

interface ImportFeedback {
  tone: 'idle' | 'success' | 'error'
  message: string
}

interface RecipeDraft {
  id?: string
  name: string
  prepTime: string
  meal: MealType
  servings: string
  ingredientsText: string
  instructions: string
}

const STORAGE_KEYS = {
  recipes: 'foodplanner.recipes.v1',
  plan: 'foodplanner.plan.v1',
} as const

const DEFAULT_SEED_KEY = 'foodplanner.seeded.vanlife'

const DEFAULT_IMPORT_FEEDBACK: ImportFeedback = {
  tone: 'idle',
  message: '',
}

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('planner')
  const [recipes, setRecipes] = useLocalStorage<Recipe[]>(STORAGE_KEYS.recipes, [])
  const [mealPlan, setMealPlan] = useLocalStorage<MealPlan>(STORAGE_KEYS.plan, {})
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>(
    DEFAULT_IMPORT_FEEDBACK,
  )

  useEffect(() => {
    if (recipes.length) return
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(DEFAULT_SEED_KEY)) return

    const validated = validateImportedRecipes(coerceRecipePayload(cookbookSeed))
    if (!validated.length) {
      window.localStorage.setItem(DEFAULT_SEED_KEY, 'true')
      return
    }

    setRecipes((existing) => {
      if (existing.length) return existing
      const withIds = validated.map<Recipe>((recipe) => ({
        id: generateId('recipe'),
        name: recipe.name.trim(),
        prepTime: recipe.prep_time.trim(),
        ingredients: recipe.ingredients.map((ingredient) => ingredient.trim()),
        meal: recipe.meal,
        servings: recipe.servings,
        instructions: recipe.instructions.trim(),
      }))

      return dedupeRecipes(existing, withIds)
    })

    window.localStorage.setItem(DEFAULT_SEED_KEY, 'true')
  }, [recipes.length, setRecipes])

  useEffect(() => {
    if (!recipes.length) return
    let mutated = false
    const upgraded = recipes.map((recipe) => {
      const normalized = normalizeServings(
        (recipe as Recipe & { servings?: unknown }).servings,
      )
      if (normalized == null) {
        mutated = true
        return { ...recipe, servings: 1 }
      }
      if (normalized !== recipe.servings) {
        mutated = true
        return { ...recipe, servings: normalized }
      }
      return recipe
    })
    if (mutated) {
      setRecipes(upgraded)
    }
  }, [recipes, setRecipes])

  const tabMeta: Record<ViewKey, { label: string; description: string }> = useMemo(
    () => ({
      planner: {
        label: 'Plan Meals',
        description: 'Arrange breakfasts, lunches, dinners, and snacks across your calendar.',
      },
      overview: {
        label: 'Meal Plan Output',
        description:
          'Generate your shopping list, itinerary, and recipe anthology for a chosen span.',
      },
      recipes: {
        label: 'Recipe Library',
        description: 'Curate, amend, and import recipes to keep your rolling pantry inspired.',
      },
    }),
    [],
  )

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const raw = await file.text()
      const payload = coerceRecipePayload(JSON.parse(raw))
      const validated = validateImportedRecipes(payload)

      if (!validated.length) {
        setImportFeedback({
          tone: 'error',
          message: 'No recipes found in file—please verify the format.',
        })
        return
      }

      setRecipes((existing) => {
        const withIds = validated.map<Recipe>((recipe) => ({
          id: generateId('recipe'),
          name: recipe.name.trim(),
          prepTime: recipe.prep_time.trim(),
          ingredients: recipe.ingredients.map((ingredient) => ingredient.trim()),
          meal: recipe.meal,
          servings: recipe.servings,
          instructions: recipe.instructions.trim(),
        }))

        return dedupeRecipes(existing, withIds)
      })

      setImportFeedback({
        tone: 'success',
        message: `Imported ${validated.length} recipe${
          validated.length === 1 ? '' : 's'
        } from “${file.name}”.`,
      })
    } catch (error) {
      console.error('Import failed', error)
      setImportFeedback({
        tone: 'error',
        message: 'Sorry, we could not process that file. Please confirm the JSON structure.',
      })
    } finally {
      event.target.value = ''
    }
  }

  const handleExportRecipes = () => {
    if (!recipes.length) return
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    try {
      const payload = {
        recipes: recipes.map((recipe) => ({
          name: recipe.name,
          prep_time: recipe.prepTime,
          meal: recipe.meal,
          servings: recipe.servings,
          ingredients: [...recipe.ingredients],
          instructions: recipe.instructions,
        })),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const dateStamp = new Date().toISOString().slice(0, 10)
      link.href = url
      link.download = `foodplanner-recipes-${dateStamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      console.error('Export failed', error)
    }
  }

  const handleAssignMeal = (date: string, meal: MealType, recipeId: string | null) => {
    setMealPlan((previous) => {
      const next = { ...previous }
      ensureDayPlan(next, date)
      const day = { ...next[date] }
      day[meal] = recipeId ?? null
      if (isDayEmpty(day)) {
        delete next[date]
      } else {
        next[date] = day
      }
      return next
    })
  }

  const handleClearWeek = (dates: string[]) => {
    setMealPlan((previous) => {
      const next = { ...previous }
      let changed = false
      dates.forEach((date) => {
        if (date in next) {
          delete next[date]
          changed = true
        }
      })
      return changed ? next : previous
    })
  }

  const handleClearAll = () => {
    if (!Object.keys(mealPlan).length) return
    setMealPlan({})
  }

  const handleCreateRecipe = (input: RecipeDraftInput) => {
    const recipe: Recipe = { id: generateId('recipe'), ...input }
    setRecipes((previous) => [...previous, recipe])
    return recipe
  }

  const handleUpdateRecipe = (id: string, input: RecipeDraftInput) => {
    let updated: Recipe | null = null
    setRecipes((previous) =>
      previous.map((recipe) => {
        if (recipe.id === id) {
          updated = { ...recipe, ...input }
          return updated
        }
        return recipe
      }),
    )
    return updated
  }

  const handleDeleteRecipe = (id: string) => {
    setRecipes((previous) => previous.filter((recipe) => recipe.id !== id))
    setMealPlan((previous) => removeRecipeFromPlan(previous, id))
  }

  const handleDuplicateRecipe = (id: string) => {
    const existing = recipes.find((recipe) => recipe.id === id)
    if (!existing) return null
    const names = new Set(recipes.map((recipe) => recipe.name.toLowerCase()))
    const duplicateName = createDuplicateName(names, existing.name)
    const clone: Recipe = {
      ...existing,
      id: generateId('recipe'),
      name: duplicateName,
    }
    setRecipes((previous) => [...previous, clone])
    return clone
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">Meal Planner</h1>
        </div>
        <p className="app-subtitle">
          Organize your recipes, plan your meals, and generate shopping lists.
        </p>
      </header>

      <nav className="tab-bar" aria-label="Primary navigation">
        {(Object.keys(tabMeta) as ViewKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className="tab-button"
            aria-pressed={activeView === key}
            onClick={() => setActiveView(key)}
          >
            {tabMeta[key].label}
          </button>
        ))}
      </nav>

      <section className="panel" aria-live="polite">
        <header>
          <h2>{tabMeta[activeView].label}</h2>
          <p className="muted">{tabMeta[activeView].description}</p>
        </header>
        <hr className="divider" />

        {activeView === 'planner' && (
          <PlannerPanel
            recipes={recipes}
            mealPlan={mealPlan}
            onAssign={handleAssignMeal}
            onClearWeek={handleClearWeek}
            onClearAll={handleClearAll}
          />
        )}

        {activeView === 'overview' && (
          <OverviewPanel recipes={recipes} mealPlan={mealPlan} />
        )}

        {activeView === 'recipes' && (
          <RecipesPanel
            recipes={recipes}
            onFileChange={handleImport}
            onExport={handleExportRecipes}
            importFeedback={importFeedback}
            onCreateRecipe={handleCreateRecipe}
            onUpdateRecipe={handleUpdateRecipe}
            onDeleteRecipe={handleDeleteRecipe}
            onDuplicateRecipe={handleDuplicateRecipe}
            onResetImportFeedback={() => setImportFeedback(DEFAULT_IMPORT_FEEDBACK)}
          />
        )}
      </section>
    </div>
  )
}

interface PlannerPanelProps {
  recipes: Recipe[]
  mealPlan: MealPlan
  onAssign: (date: string, meal: MealType, recipeId: string | null) => void
  onClearWeek: (dates: string[]) => void
  onClearAll: () => void
}

function PlannerPanel({
  recipes,
  mealPlan,
  onAssign,
  onClearWeek,
  onClearAll,
}: PlannerPanelProps) {
  const [anchor, setAnchor] = useState<string>(() => getDefaultWeekAnchor())
  const [activeSlot, setActiveSlot] = useState<{ date: string; meal: MealType } | null>(null)

  const week = useMemo(() => weekDates(anchor), [anchor])

  const sortedRecipes = useMemo(
    () => [...recipes].sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  )

  const recipeIndex = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.id, recipe])),
    [recipes],
  )

  const assignmentsInWeek = useMemo(() => {
    let count = 0
    week.forEach((date) => {
      const day = mealPlan[date]
      if (!day) return
      MEAL_TYPES.forEach((meal) => {
        if (day[meal]) count += 1
      })
    })
    return count
  }, [week, mealPlan])

  const hasAnyAssignments = assignmentsInWeek > 0
  const totalAssignments = Object.values(mealPlan).reduce((total, day) => {
    return (
      total +
      MEAL_TYPES.reduce((acc, meal) => {
        return acc + (day[meal] ? 1 : 0)
      }, 0)
    )
  }, 0)

  useEffect(() => {
    if (!activeSlot) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveSlot(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeSlot])

  const handleAnchorChange = (value: string) => {
    if (value) {
      setAnchor(value)
    }
  }

  const handleOpenPicker = (date: string, meal: MealType) => {
    setActiveSlot({ date, meal })
  }

  const handleSelectFromPicker = (recipeId: string) => {
    if (!activeSlot) return
    onAssign(activeSlot.date, activeSlot.meal, recipeId)
    setActiveSlot(null)
  }

  const handleClosePicker = () => setActiveSlot(null)

  return (
    <div className="planner">
      <div className="planner-controls">
        <div className="input-group">
          <label htmlFor="week-start">Week starting</label>
          <input
            id="week-start"
            type="date"
            value={anchor}
            onChange={(event) => handleAnchorChange(event.target.value)}
            className="text-input"
          />
        </div>
        <div className="planner-toolbar">
          <button
            type="button"
            className="button-ghost"
            onClick={() => setAnchor(addDays(anchor, -7))}
          >
            ⬅︎ Previous
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={() => setAnchor(getDefaultWeekAnchor())}
          >
            Today
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={() => setAnchor(addDays(anchor, 7))}
          >
            Next ➝
          </button>
        </div>
        <div className="planner-toolbar">
          <span className="muted text-small">
            Meals this week: <strong>{assignmentsInWeek}</strong>
          </span>
          <button
            type="button"
            className="button-ghost"
            onClick={() => onClearWeek(week)}
            disabled={!hasAnyAssignments}
          >
            Clear week
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={onClearAll}
            disabled={!totalAssignments}
          >
            Clear all
          </button>
        </div>
      </div>

      <div className="planner-grid">
        {week.map((date) => {
          const day = mealPlan[date]
          return (
            <article key={date} className="planner-column">
              <header>
                <h3>{formatDateLabel(date)}</h3>
                <span className="muted text-small">{date}</span>
              </header>
              <div className="planner-slots">
                {MEAL_TYPES.map((meal) => {
                  const assignedId = day?.[meal] ?? null
                  const assignedRecipe = assignedId ? recipeIndex.get(assignedId) : undefined
                  const hasRecipes = sortedRecipes.length > 0
                  return (
                    <div key={meal} className="meal-slot">
                      <div className="meal-slot-header">
                        <span className="meal-slot-title">{capitalizeMeal(meal)}</span>
                      </div>
                      {!assignedRecipe && (
                        <>
                          <button
                            type="button"
                            className="button-dashed"
                            onClick={() => handleOpenPicker(date, meal)}
                            aria-haspopup="dialog"
                          >
                            Add meal
                          </button>
                          <p className="muted text-small">
                            {hasRecipes ? `No ${meal} planned yet.` : 'No recipes yet.'}
                          </p>
                        </>
                      )}
                      {assignedRecipe && (
                        <div className="meal-assignment">
                          <div className="meal-assignment-info">
                            <strong>{assignedRecipe.name}</strong>
                            <span className="muted text-small">
                              Serves {formatServings(assignedRecipe.servings)} ·{' '}
                              {assignedRecipe.prepTime}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="meal-remove-button"
                            onClick={() => onAssign(date, meal, null)}
                            aria-label={`Remove ${assignedRecipe.name} from ${meal}`}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>
      {activeSlot && (
        <MealPicker
          date={activeSlot.date}
          meal={activeSlot.meal}
          recipes={sortedRecipes}
          assignedId={mealPlan[activeSlot.date]?.[activeSlot.meal] ?? null}
          onSelect={handleSelectFromPicker}
          onClose={handleClosePicker}
        />
      )}
    </div>
  )
}

interface MealPickerProps {
  date: string
  meal: MealType
  recipes: Recipe[]
  assignedId: string | null
  onSelect: (recipeId: string) => void
  onClose: () => void
}

function MealPicker({ date, meal, recipes, assignedId, onSelect, onClose }: MealPickerProps) {
  const headingId = `meal-picker-${date}-${meal}`
  return (
    <div className="meal-picker-overlay" role="presentation" onClick={onClose}>
      <div
        className="meal-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="meal-picker-header">
          <div className="meal-picker-heading">
            <span className="tag">{formatDateLabel(date)}</span>
            <h4 id={headingId}>Pick a {capitalizeMeal(meal)}</h4>
          </div>
          <button
            type="button"
            className="meal-picker-close"
            onClick={onClose}
            aria-label="Close meal picker"
          >
            ×
          </button>
        </header>
        {recipes.length ? (
          <ul className="meal-picker-options">
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <button
                  type="button"
                  className={`meal-picker-option ${assignedId === recipe.id ? 'active' : ''}`}
                  onClick={() => onSelect(recipe.id)}
                >
                  <span className="meal-picker-option-name">{recipe.name}</span>
                  <span className="meal-picker-option-meta">
                    Serves {formatServings(recipe.servings)} · {capitalizeMeal(recipe.meal)} ·{' '}
                    {recipe.prepTime}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meal-picker-empty">
            You have no recipes yet. Visit the recipe library to add some.
          </p>
        )}
      </div>
    </div>
  )
}

interface OverviewPanelProps {
  recipes: Recipe[]
  mealPlan: MealPlan
}

function OverviewPanel({ recipes, mealPlan }: OverviewPanelProps) {
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  const invalidRange = Boolean(rangeStart && rangeEnd && rangeStart > rangeEnd)
  const hasRange = Boolean(rangeStart && rangeEnd)

  const outputs = useMemo(() => {
    if (!hasRange || invalidRange) return null
    return buildPlanOutputs(mealPlan, recipes, rangeStart, rangeEnd)
  }, [mealPlan, recipes, rangeStart, rangeEnd, hasRange, invalidRange])

  const rangeLabel =
    hasRange && !invalidRange ? formatDateRangeDisplay(rangeStart, rangeEnd) : ''

  const handleCurrentWeek = () => {
    const anchor = getDefaultWeekAnchor()
    const days = weekDates(anchor)
    if (!days.length) return
    setRangeStart(days[0])
    setRangeEnd(days[days.length - 1])
  }

  useEffect(() => {
    setCopyStatus('idle')
  }, [rangeStart, rangeEnd, outputs])

  const shoppingListText = useMemo(() => {
    if (!outputs) return ''
    const header = ['Ingredient', 'Quantity']
    const rows = outputs.shoppingList.map((item) => [
      item.ingredient,
      `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`.trim(),
    ])
    return [header, ...rows].map((row) => row.join('\t')).join('\n')
  }, [outputs])

  const handleCopyShoppingList = async () => {
    if (!outputs || !outputs.shoppingList.length) return
    const text = shoppingListText
    const fallbackCopy = (value: string) => {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'absolute'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(textarea)
      }
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        fallbackCopy(text)
      }
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 2500)
    } catch (error) {
      console.error('Copy shopping list failed', error)
      try {
        fallbackCopy(text)
        setCopyStatus('copied')
        window.setTimeout(() => setCopyStatus('idle'), 2500)
      } catch (fallbackError) {
        console.error('Fallback copy failed', fallbackError)
        setCopyStatus('error')
        window.setTimeout(() => setCopyStatus('idle'), 3000)
      }
    }
  }

  return (
    <div className="overview">
      <div className="overview-filters">
        <div className="input-group">
            <label htmlFor="range-start">From</label>
            <input
              id="range-start"
              type="date"
              value={rangeStart}
              onChange={(event) => setRangeStart(event.target.value)}
              className="text-input"
            />
          </div>
        <div className="input-group">
          <label htmlFor="range-end">To</label>
          <input
            id="range-end"
            type="date"
            value={rangeEnd}
            onChange={(event) => setRangeEnd(event.target.value)}
            className="text-input"
          />
        </div>
        <button type="button" className="button-ghost" onClick={handleCurrentWeek}>
          Use current week
        </button>
        <button
          type="button"
          className="button-ghost"
          onClick={() => {
            setRangeStart('')
            setRangeEnd('')
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={() => window.print()}
          disabled={!outputs}
        >
          Download PDF
        </button>
      </div>

      {invalidRange && (
        <div className="notice notice-error" role="alert">
          The end date must be on or after the start date.
        </div>
      )}

      {hasRange ? (
        outputs ? (
          <div className="overview-content">
            <section className="overview-summary">
              <h3>Range overview</h3>
              <p className="muted">{rangeLabel}</p>
              <div className="summary-grid">
                <div>
                  <p className="summary-metric">{outputs.plannedMeals}</p>
                  <p className="muted text-small">Meals scheduled</p>
                </div>
                <div>
                  <p className="summary-metric">{outputs.shoppingList.length}</p>
                  <p className="muted text-small">Shopping items</p>
                </div>
                <div>
                  <p className="summary-metric">{outputs.recipes.length}</p>
                  <p className="muted text-small">Recipes referenced</p>
                </div>
              </div>
            </section>

            <section className="shopping-list">
              <h3>Shopping list</h3>
              <div className="section-toolbar">
                <button
                  type="button"
                  className="button-ghost"
                  onClick={handleCopyShoppingList}
                  disabled={!outputs.shoppingList.length}
                >
                  Copy shopping list
                </button>
                {copyStatus === 'copied' && (
                  <span className="copy-feedback" role="status">
                    Copied to clipboard.
                  </span>
                )}
                {copyStatus === 'error' && (
                  <span className="copy-feedback copy-feedback-error" role="status">
                    Unable to copy.
                  </span>
                )}
              </div>
              <table className="list-table">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.shoppingList.map((item) => (
                    <tr key={`${item.ingredient}-${item.unit ?? 'each'}`}>
                      <td>{item.ingredient}</td>
                      <td>
                        {item.quantity}
                        {item.unit ? ` ${item.unit}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="itinerary">
              <h3>Daily itinerary</h3>
              <div className="itinerary-grid">
                {outputs.itinerary.map((day) => (
                  <article key={day.date} className="itinerary-day">
                    <header>
                      <h4>{formatDateLabel(day.date)}</h4>
                      <span className="muted text-small">{day.date}</span>
                    </header>
                    <ul>
                      {day.meals.map(({ meal, recipe }) => (
                        <li key={`${day.date}-${meal}`} className="itinerary-meal">
                          <span className="tag">{capitalizeMeal(meal)}</span>
                          <div>
                            <p>{recipe.name}</p>
                            <p className="muted text-small">
                              Serves {formatServings(recipe.servings)} · {recipe.prepTime}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="recipe-book">
              <h3>Recipe book</h3>
              <div className="recipe-grid">
                {outputs.recipes.map((recipe) => (
                  <article key={recipe.id} className="recipe-card">
                    <header>
                      <h4>{recipe.name}</h4>
                      <span className="muted text-small">
                        Serves {formatServings(recipe.servings)} · {capitalizeMeal(recipe.meal)} ·{' '}
                        {recipe.prepTime}
                      </span>
                    </header>
                    <div>
                      <h5>Ingredients</h5>
                      <ul>
                        {recipe.ingredients.map((ingredient) => (
                          <li key={ingredient}>{ingredient}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h5>Instructions</h5>
                      <p className="recipe-instructions">{recipe.instructions}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : (
          !invalidRange && (
            <div className="empty-state">
              <p>No meals scheduled between these dates yet. Visit the planner to place recipes.</p>
            </div>
          )
        )
      ) : (
        <div className="empty-state">
          <p>Select a start and end date to see a curated shopping list and printable plan.</p>
        </div>
      )}
    </div>
  )
}

interface RecipesPanelProps {
  recipes: Recipe[]
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onExport: () => void
  importFeedback: ImportFeedback
  onCreateRecipe: (input: RecipeDraftInput) => Recipe
  onUpdateRecipe: (id: string, input: RecipeDraftInput) => Recipe | null
  onDeleteRecipe: (id: string) => void
  onDuplicateRecipe: (id: string) => Recipe | null
  onResetImportFeedback: () => void
}

function RecipesPanel({
  recipes,
  onFileChange,
  onExport,
  importFeedback,
  onCreateRecipe,
  onUpdateRecipe,
  onDeleteRecipe,
  onDuplicateRecipe,
  onResetImportFeedback,
}: RecipesPanelProps) {
  const [selectedId, setSelectedId] = useState<'new' | string>(() => recipes[0]?.id ?? 'new')
  const [draft, setDraft] = useState<RecipeDraft>(() =>
    recipes[0] ? recipeToDraft(recipes[0]) : createEmptyDraft(),
  )
  const [panelFeedback, setPanelFeedback] =
    useState<ImportFeedback>(DEFAULT_IMPORT_FEEDBACK)

  const sortedRecipes = useMemo(
    () => [...recipes].sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  )

  useEffect(() => {
    if (selectedId === 'new') return
    const exists = recipes.find((recipe) => recipe.id === selectedId)
    if (!exists) {
      const fallback = recipes[0]
      setSelectedId(fallback?.id ?? 'new')
      setDraft(fallback ? recipeToDraft(fallback) : createEmptyDraft())
    }
  }, [recipes, selectedId])

  const handleSelectRecipe = (id: 'new' | string) => {
    setSelectedId(id)
    setPanelFeedback(DEFAULT_IMPORT_FEEDBACK)
    if (id === 'new') {
      setDraft(createEmptyDraft())
    } else {
      const recipe = recipes.find((item) => item.id === id)
      if (recipe) {
        setDraft(recipeToDraft(recipe))
      }
    }
  }

  const handleDraftChange =
    (field: keyof RecipeDraft) => (value: string) => {
      setDraft((previous) => ({ ...previous, [field]: value }))
    }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationError = validateDraft(draft)
    if (validationError) {
      setPanelFeedback({ tone: 'error', message: validationError })
      return
    }

    const input = draftToInput(draft)

    if (draft.id) {
      const updated = onUpdateRecipe(draft.id, input)
      if (updated) {
        setDraft(recipeToDraft(updated))
        setPanelFeedback({ tone: 'success', message: 'Recipe updated.' })
      } else {
        setPanelFeedback({ tone: 'error', message: 'Unable to save changes.' })
      }
    } else {
      const created = onCreateRecipe(input)
      setSelectedId(created.id)
      setDraft(recipeToDraft(created))
      setPanelFeedback({ tone: 'success', message: 'Recipe added to the library.' })
    }
  }

  const handleDuplicate = () => {
    if (!draft.id) return
    const duplicated = onDuplicateRecipe(draft.id)
    if (duplicated) {
      setSelectedId(duplicated.id)
      setDraft(recipeToDraft(duplicated))
      setPanelFeedback({ tone: 'success', message: 'Recipe duplicated.' })
    }
  }

  const handleDelete = () => {
    if (!draft.id) return
    const confirmDelete = window.confirm(
      `Remove “${draft.name || 'Untitled recipe'}” from your library?`,
    )
    if (!confirmDelete) return
    onDeleteRecipe(draft.id)
    setSelectedId('new')
    setDraft(createEmptyDraft())
    setPanelFeedback({ tone: 'success', message: 'Recipe removed.' })
  }

  return (
    <div className="recipes-panel">
      <section className="library">
        <div className="import-panel">
          <label className="button-primary" htmlFor="recipe-upload">
            ⬆️ Upload JSON
          </label>
          <button
            type="button"
            className="button-ghost"
            onClick={onExport}
            disabled={!recipes.length}
          >
            ⬇️ Export recipes
          </button>
          <input
            id="recipe-upload"
            type="file"
            accept="application/json"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <p className="muted text-small">
            Provide a file with a <code>recipes</code> array (name, meal, servings, ingredients,
            prep_time, instructions).
          </p>
          {importFeedback.tone !== 'idle' && (
            <div
              className={`notice ${
                importFeedback.tone === 'error' ? 'notice-error' : 'notice-success'
              }`}
              role={importFeedback.tone === 'error' ? 'alert' : 'status'}
            >
              <span>{importFeedback.message}</span>
              <button type="button" className="link-button" onClick={onResetImportFeedback}>
                Dismiss
              </button>
            </div>
          )}
        </div>
        <div>
          <h3>Library</h3>
          <p className="muted text-small">
            {recipes.length
              ? `You have ${recipes.length} recipe${recipes.length === 1 ? '' : 's'} saved.`
              : 'No recipes yet—start by importing or composing your own.'}
          </p>
        </div>
        

        <div className="library-list">
          <button
            type="button"
            className={`library-item ${selectedId === 'new' ? 'active' : ''}`}
            onClick={() => handleSelectRecipe('new')}
          >
            <span>+ New recipe</span>
            <span className="muted text-small">Begin with a blank page</span>
          </button>
          {sortedRecipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              className={`library-item ${selectedId === recipe.id ? 'active' : ''}`}
              onClick={() => handleSelectRecipe(recipe.id)}
            >
              <span>{recipe.name}</span>
              <span className="muted text-small">
                Serves {formatServings(recipe.servings)} · {capitalizeMeal(recipe.meal)} ·{' '}
                {recipe.prepTime}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="editor">
        <header>
          <h3>{draft.id ? 'Edit recipe' : 'Compose recipe'}</h3>
          {draft.id && <p className="muted text-small">Editing {draft.name}</p>}
        </header>

        <form onSubmit={handleSubmit} className="recipe-form">
          <div className="input-group">
            <label htmlFor="recipe-name">Recipe name</label>
            <input
              id="recipe-name"
              className="text-input"
              value={draft.name}
              onChange={(event) => handleDraftChange('name')(event.target.value)}
              placeholder="Campfire shakshuka"
              required
            />
          </div>

          <div className="grid two">
            <div className="input-group">
              <label htmlFor="recipe-meal">Meal</label>
              <select
                id="recipe-meal"
                className="select-input"
                value={draft.meal}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    meal: event.target.value as MealType,
                  }))
                }
              >
                {MEAL_TYPES.map((meal) => (
                  <option key={meal} value={meal}>
                    {capitalizeMeal(meal)}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="recipe-servings">Servings</label>
              <input
                id="recipe-servings"
                type="number"
                min="1"
                step="any"
                className="text-input"
                value={draft.servings}
                onChange={(event) => handleDraftChange('servings')(event.target.value)}
                placeholder="4"
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="recipe-prep">Prep time</label>
              <input
                id="recipe-prep"
                className="text-input"
                value={draft.prepTime}
                onChange={(event) => handleDraftChange('prepTime')(event.target.value)}
                placeholder="20 minutes"
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="recipe-ingredients">Ingredients</label>
            <textarea
              id="recipe-ingredients"
              className="textarea-input"
              rows={6}
              value={draft.ingredientsText}
              onChange={(event) => handleDraftChange('ingredientsText')(event.target.value)}
              placeholder={'2 eggs\n1 tbsp olive oil\n1 cup spinach'}
            />
            <span className="muted text-small">
              One ingredient per line (quantity first to improve shopping list aggregation).
            </span>
          </div>

          <div className="input-group">
            <label htmlFor="recipe-instructions">Instructions</label>
            <textarea
              id="recipe-instructions"
              className="textarea-input"
              rows={8}
              value={draft.instructions}
              onChange={(event) => handleDraftChange('instructions')(event.target.value)}
              placeholder="Describe each step clearly for future you."
            />
          </div>

          {panelFeedback.tone !== 'idle' && (
            <div
              className={`notice ${
                panelFeedback.tone === 'error' ? 'notice-error' : 'notice-success'
              }`}
              role={panelFeedback.tone === 'error' ? 'alert' : 'status'}
            >
              {panelFeedback.message}
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="button-primary">
              {draft.id ? 'Save changes' : 'Add recipe'}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => {
                setSelectedId('new')
                setDraft(createEmptyDraft())
                setPanelFeedback(DEFAULT_IMPORT_FEEDBACK)
              }}
            >
              Reset
            </button>
            {draft.id && (
              <>
                <button type="button" className="button-ghost" onClick={handleDuplicate}>
                  Duplicate
                </button>
                <button type="button" className="button-danger" onClick={handleDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}

function coerceRecipePayload(data: unknown): RecipeImportPayload {
  if (data && typeof data === 'object' && Array.isArray((data as RecipeImportPayload).recipes)) {
    return data as RecipeImportPayload
  }

  if (Array.isArray(data)) {
    return { recipes: data as RawImportedRecipe[] }
  }

  return { recipes: [] }
}

function normalizeImportedIngredients(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      return []
    }

    const candidates = trimmed
      .split(/\r?\n|[,;•]/)
      .map((segment) => segment.replace(/^[\-\u2022*]\s*/, '').trim())
      .filter(Boolean)

    return candidates.length ? candidates : [trimmed]
  }

  return []
}

function normalizeServings(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return null
    }
    return Number.parseFloat(raw.toFixed(2))
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      return null
    }
    const numeric = Number.parseFloat(trimmed)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null
    }
    return Number.parseFloat(numeric.toFixed(2))
  }

  return null
}

function normalizeFieldKey(key: string) {
  return key.toLowerCase().replace(/[\s_-]+/g, '')
}

function createFlexibleFieldLookup(source: Record<string, unknown>) {
  // Collapse variations like "prep time" vs "prep_time" into a consistent lookup.
  const lookup = new Map<string, unknown>()
  Object.entries(source).forEach(([key, value]) => {
    if (!key) return
    const normalized = normalizeFieldKey(key)
    if (!lookup.has(normalized)) {
      lookup.set(normalized, value)
    }
  })
  return lookup
}

function pickStringField(lookup: Map<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = lookup.get(normalizeFieldKey(key))
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }
  return null
}

function normalizeMealTypeField(raw: string | null): MealType | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if (!value) return null
  if (value === 'breakfast' || value.includes('breakfast')) {
    return 'breakfast'
  }
  if (value === 'snack' || value.includes('snack')) {
    return 'snack'
  }
  if (value.includes('dessert') || value.includes('sweet') || value.includes('treat')) {
    return 'snack'
  }
  if (value === 'lunch' || (value.includes('lunch') && !value.includes('dinner'))) {
    return 'lunch'
  }
  if (value.includes('dinner') || value.includes('supper')) {
    return 'dinner'
  }
  return null
}

function validateImportedRecipes(payload: RecipeImportPayload): ImportedRecipe[] {
  if (!payload || !Array.isArray(payload.recipes)) {
    return []
  }

  return payload.recipes
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return null
      }

      const lookup = createFlexibleFieldLookup(candidate as Record<string, unknown>)
      const name = pickStringField(lookup, ['name'])
      const prepTime = pickStringField(lookup, ['prep_time', 'prep time', 'preptime'])
      const instructions = pickStringField(lookup, [
        'instructions',
        'instruction',
        'directions',
        'method',
      ])
      const meal = normalizeMealTypeField(
        pickStringField(lookup, ['meal', 'meal type', 'meal_type', 'course', 'category']),
      )
      const ingredientsRaw = lookup.get(normalizeFieldKey('ingredients'))
      const ingredients = normalizeImportedIngredients(ingredientsRaw)
      const servings = normalizeServings(lookup.get(normalizeFieldKey('servings')))

      if (
        !name ||
        !prepTime ||
        !instructions ||
        !meal ||
        !ingredients.length ||
        servings == null
      ) {
        return null
      }

      return {
        name,
        prep_time: prepTime,
        instructions,
        meal,
        ingredients,
        servings,
      }
    })
    .filter((recipe): recipe is ImportedRecipe => recipe != null)
}

function getDefaultWeekAnchor() {
  const today = new Date()
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dayIndex = midnight.getDay() // 0 (Sunday) through 6
  const diff = (dayIndex + 6) % 7 // number of days since Monday
  midnight.setDate(midnight.getDate() - diff)
  return toDateInputValue(midnight)
}

function capitalizeMeal(meal: MealType) {
  return meal.charAt(0).toUpperCase() + meal.slice(1)
}

function formatServings(value: number) {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number.parseFloat(value.toFixed(2))
  if (Number.isInteger(rounded)) {
    return String(rounded)
  }
  return rounded.toString()
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase())
}

function isDayEmpty(day: DayPlan) {
  return MEAL_TYPES.every((meal) => !day[meal])
}

function removeRecipeFromPlan(plan: MealPlan, recipeId: string) {
  let changed = false
  const nextPlan: MealPlan = {}

  Object.entries(plan).forEach(([date, day]) => {
    let dayChanged = false
    const updatedDay: DayPlan = { ...day }
    MEAL_TYPES.forEach((meal) => {
      if (updatedDay[meal] === recipeId) {
        updatedDay[meal] = null
        dayChanged = true
      }
    })

    if (dayChanged) {
      changed = true
      if (!isDayEmpty(updatedDay)) {
        nextPlan[date] = updatedDay
      }
    } else {
      nextPlan[date] = day
    }
  })

  return changed ? nextPlan : plan
}

function createDuplicateName(existingNames: Set<string>, baseName: string) {
  let attempt = `${baseName} (Copy)`
  let counter = 2
  while (existingNames.has(attempt.toLowerCase())) {
    attempt = `${baseName} (Copy ${counter})`
    counter += 1
  }
  return attempt
}

function buildPlanOutputs(
  mealPlan: MealPlan,
  recipes: Recipe[],
  start: string,
  end: string,
): PlanOutputs | null {
  const dates = dateRangeInclusive(start, end)
  if (!dates.length) return null

  const recipeMap = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const itinerary: DayItinerary[] = []
  const shoppingMap = new Map<string, ShoppingListItem>()
  const usedRecipes = new Map<string, Recipe>()
  let plannedMeals = 0

  dates.forEach((date) => {
    const day = mealPlan[date]
    if (!day) return
    const mealsForDay: Array<{ meal: MealType; recipe: Recipe }> = []
    MEAL_TYPES.forEach((meal) => {
      const recipeId = day[meal]
      if (!recipeId) return
      const recipe = recipeMap.get(recipeId)
      if (!recipe) return
      mealsForDay.push({ meal, recipe })
      plannedMeals += 1
      usedRecipes.set(recipe.id, recipe)

      recipe.ingredients.forEach((ingredient) => {
        const parsed = parseIngredientDetails(ingredient)
        const quantity = parsed.quantity ?? 1
        const key = `${parsed.item}__${parsed.unit ?? 'each'}`
        const existing = shoppingMap.get(key)
        if (existing) {
          existing.quantity = Number.parseFloat((existing.quantity + quantity).toFixed(2))
        } else {
          shoppingMap.set(key, {
            ingredient: toTitleCase(parsed.item),
            quantity: Number.parseFloat(quantity.toFixed(2)),
            unit: parsed.unit,
          })
        }
      })
    })
    if (mealsForDay.length) {
      mealsForDay.sort((a, b) => MEAL_TYPES.indexOf(a.meal) - MEAL_TYPES.indexOf(b.meal))
      itinerary.push({ date, meals: mealsForDay })
    }
  })

  if (!itinerary.length) return null

  const shoppingList = Array.from(shoppingMap.values()).sort((a, b) =>
    a.ingredient.localeCompare(b.ingredient),
  )

  return {
    shoppingList,
    itinerary,
    recipes: Array.from(usedRecipes.values()).sort((a, b) => a.name.localeCompare(b.name)),
    plannedMeals,
  }
}

function createEmptyDraft(): RecipeDraft {
  return {
    name: '',
    prepTime: '',
    meal: 'breakfast',
    servings: '',
    ingredientsText: '',
    instructions: '',
  }
}

function recipeToDraft(recipe: Recipe): RecipeDraft {
  return {
    id: recipe.id,
    name: recipe.name,
    prepTime: recipe.prepTime,
    meal: recipe.meal,
    servings: String(recipe.servings),
    ingredientsText: recipe.ingredients.join('\n'),
    instructions: recipe.instructions,
  }
}

function draftToInput(draft: RecipeDraft): RecipeDraftInput {
  const ingredients = draft.ingredientsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    name: draft.name.trim(),
    meal: draft.meal,
    prepTime: draft.prepTime.trim(),
    servings: Number.parseFloat(draft.servings),
    ingredients,
    instructions: draft.instructions.trim(),
  }
}

function validateDraft(draft: RecipeDraft) {
  if (!draft.name.trim()) return 'Please provide a recipe name.'
  if (!draft.servings.trim()) return 'Specify how many servings this recipe makes.'
  const servingsValue = Number.parseFloat(draft.servings)
  if (!Number.isFinite(servingsValue) || servingsValue <= 0) {
    return 'Servings must be a positive number.'
  }
  if (!draft.ingredientsText.trim()) return 'List at least one ingredient.'
  if (!draft.instructions.trim()) return 'Include preparation instructions.'
  return null
}

export default App
