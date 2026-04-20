// Tracks how many times the current browser session has launched a specific
// game. Used by the Game Over overlay ("Attempt N"). Purely cosmetic — the
// backend session report is the source of truth for real analytics.
//
// Backed by sessionStorage when available (so the counter survives a
// hard-reload within the same tab) with an in-memory Map fallback when it
// isn't (private mode, cross-origin iframes, etc.).
const STORAGE_KEY = 'gemmaplay.attempts'
const memory = new Map()

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return null
  }
}

function writeStore(obj) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    /* session storage disabled — memory map is still updated */
  }
}

export function getAttempts(gameId) {
  const key = gameId || 'unknown'
  if (memory.has(key)) return memory.get(key)
  const store = readStore()
  const n = (store && store[key]) || 0
  if (n) memory.set(key, n)
  return n
}

export function incrementAttempts(gameId) {
  const key = gameId || 'unknown'
  const next = getAttempts(key) + 1
  memory.set(key, next)
  const store = readStore() || {}
  store[key] = next
  writeStore(store)
  return next
}
