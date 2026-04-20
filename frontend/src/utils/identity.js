// Ephemeral identity: teacher username cached in localStorage so repeat
// uploads in the same browser skip the prompt. 24h expiry so stale identities
// (shared machines, leaving a tab open for a week) re-prompt on return.
const USERNAME_KEY = 'gp_teacher_username'
const SET_AT_KEY = 'gp_teacher_set_at'
const STUDENT_KEY = 'gp_student_name'
const SESSION_TOKEN_KEY = 'gp_session_token'
const SESSION_EXPIRES_KEY = 'gp_session_expires_at'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

function storage() {
  try { return window.localStorage } catch { return null }
}

export function getTeacherUsername() {
  const s = storage()
  if (!s) return null
  const name = s.getItem(USERNAME_KEY)
  return name && name.trim() ? name : null
}

export function setTeacherUsername(name) {
  const s = storage()
  if (!s) return
  s.setItem(USERNAME_KEY, name)
  s.setItem(SET_AT_KEY, String(Date.now()))
}

export function clearTeacherUsername() {
  const s = storage()
  if (!s) return
  s.removeItem(USERNAME_KEY)
  s.removeItem(SET_AT_KEY)
}

export function getTeacherUsernameLastSet() {
  const s = storage()
  if (!s) return null
  const raw = s.getItem(SET_AT_KEY)
  if (!raw) return null
  const ms = parseInt(raw, 10)
  return Number.isFinite(ms) ? new Date(ms) : null
}

export function teacherUsernameIsFresh() {
  const setAt = getTeacherUsernameLastSet()
  if (!setAt) return false
  return Date.now() - setAt.getTime() < TWENTY_FOUR_HOURS_MS
}

export function getStudentName() {
  const s = storage()
  if (!s) return null
  const name = s.getItem(STUDENT_KEY)
  return name && name.trim() ? name : null
}

export function setStudentName(name) {
  const s = storage()
  if (!s) return
  s.setItem(STUDENT_KEY, name)
}

export function clearStudentName() {
  const s = storage()
  if (!s) return
  s.removeItem(STUDENT_KEY)
}

export const USERNAME_RE = /^[A-Za-z0-9_]{2,24}$/
export const PIN_RE = /^\d{6}$/

// ---------------------------------------------------------------------------
// Session (JWT from /api/auth/register or /signin)
// ---------------------------------------------------------------------------

export function getSessionToken() {
  const s = storage()
  if (!s) return null
  return s.getItem(SESSION_TOKEN_KEY) || null
}

export function getSessionExpiresAt() {
  const s = storage()
  if (!s) return null
  const raw = s.getItem(SESSION_EXPIRES_KEY)
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? new Date(t) : null
}

export function isSessionValid() {
  const token = getSessionToken()
  const exp = getSessionExpiresAt()
  if (!token || !exp) return false
  return exp.getTime() > Date.now()
}

/**
 * Persist a session after register/signIn.
 * Mirrors the username onto the teacher-username key so dashboard and
 * lesson-filtering code that still reads it keeps working.
 */
export function setSession({ token, expiresAt, username }) {
  const s = storage()
  if (!s) return
  if (token) s.setItem(SESSION_TOKEN_KEY, token)
  if (expiresAt) s.setItem(SESSION_EXPIRES_KEY, expiresAt)
  if (username) {
    s.setItem(USERNAME_KEY, username)
    s.setItem(SET_AT_KEY, String(Date.now()))
  }
}

export function clearSession() {
  const s = storage()
  if (!s) return
  s.removeItem(SESSION_TOKEN_KEY)
  s.removeItem(SESSION_EXPIRES_KEY)
  s.removeItem(USERNAME_KEY)
  s.removeItem(SET_AT_KEY)
}
