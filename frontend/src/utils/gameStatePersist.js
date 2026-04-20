// Per-tab persistence of in-progress game state. Writes to sessionStorage
// keyed by gameId so a reload puts the student back where they were.
//
// Shape is intentionally free-form: each Phaser scene decides what to save.
// The only contract: `gameOver: true` marks a finished run and suppresses
// restore. Keep payloads small (< ~50KB) — stringified JSON goes into
// sessionStorage on every answer.
const KEY_PREFIX = 'gp_game_state_'

function storage() {
  try { return window.sessionStorage } catch { return null }
}

export function saveGameState(gameId, state) {
  const s = storage()
  if (!s || !gameId) return
  try {
    s.setItem(KEY_PREFIX + gameId, JSON.stringify({ ...state, savedAt: Date.now() }))
  } catch {
    // Quota exceeded or serialization error — drop silently, reload will
    // fall back to a fresh start.
  }
}

export function loadGameState(gameId) {
  const s = storage()
  if (!s || !gameId) return null
  try {
    const raw = s.getItem(KEY_PREFIX + gameId)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && parsed.gameOver) return null
    return parsed
  } catch {
    return null
  }
}

export function clearGameState(gameId) {
  const s = storage()
  if (!s || !gameId) return
  try { s.removeItem(KEY_PREFIX + gameId) } catch { /* ignore */ }
}

export function hasGameState(gameId) {
  return loadGameState(gameId) != null
}
