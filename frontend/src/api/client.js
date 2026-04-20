// Thin API client. Uses Vite proxy in dev; VITE_API_BASE in prod.
import {
  getSessionToken,
  getTeacherUsername,
} from '../utils/identity.js'

const BASE = import.meta.env.VITE_API_BASE || ''

function authHeaders() {
  const h = {}
  const teacher = getTeacherUsername()
  if (teacher) h['X-Teacher-Username'] = teacher
  const token = getSessionToken()
  if (token) h['X-Session-Token'] = token
  return h
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown for any non-2xx response. Carries the HTTP status, the full parsed
 * body (`apiBody`) and the source URL so callers can render details or let
 * the user copy them to clipboard for debugging.
 */
export class ApiError extends Error {
  constructor({ message, status, apiBody, url }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.apiBody = apiBody
    this.url = url
  }
}

/** 422 with `code: "insufficient_content"` from the backend. */
export class InsufficientContentError extends ApiError {
  constructor({ data, status, url }) {
    super({
      message: (data && data.message) || 'Not enough content for a full game.',
      status,
      apiBody: data,
      url,
    })
    this.name = 'InsufficientContentError'
    this.data = data || {}
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** Flatten whatever the backend returned into a human-readable string. */
function stringifyDetail(body) {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (typeof body !== 'object') return String(body)
  // FastAPI shape: { detail: "..." } or { detail: [{loc, msg, type}, ...] }
  const detail = body.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item) return ''
        if (typeof item === 'string') return item
        const loc = Array.isArray(item.loc) ? item.loc.join('.') : item.loc
        return [loc, item.msg || item.type].filter(Boolean).join(': ')
      })
      .filter(Boolean)
      .join('; ')
  }
  if (detail && typeof detail === 'object') {
    return detail.message || JSON.stringify(detail)
  }
  if (body.message) return String(body.message)
  return ''
}

async function parseBody(res) {
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    try { return await res.clone().json() } catch { /* fall through */ }
  }
  try { return await res.text() } catch { return null }
}

async function raiseForStatus(res, url) {
  if (res.ok) return null
  const body = await parseBody(res)

  // Typed special case: insufficient_content
  if (
    res.status === 422 &&
    body &&
    typeof body === 'object' &&
    body.code === 'insufficient_content'
  ) {
    throw new InsufficientContentError({ data: body, status: res.status, url })
  }

  const detail = stringifyDetail(body)
  const message = detail
    ? `${detail} (HTTP ${res.status})`
    : `Request failed (HTTP ${res.status})`
  throw new ApiError({ message, status: res.status, apiBody: body, url })
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

async function request(path, opts = {}) {
  const url = `${BASE}${path}`
  let res
  try {
    res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(opts.headers || {}),
      },
      ...opts,
    })
  } catch (networkErr) {
    throw new ApiError({
      message: `Network error: ${networkErr.message || 'could not reach server'}.`,
      status: 0,
      apiBody: null,
      url,
    })
  }
  await raiseForStatus(res, url)
  try { return await res.json() } catch { return null }
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const api = {
  // Lessons
  uploadLesson: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    const url = `${BASE}/api/lessons`
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        body: fd,
        headers: { ...authHeaders() },
      })
    } catch (networkErr) {
      throw new ApiError({
        message: `Network error: ${networkErr.message || 'could not reach server'}.`,
        status: 0, apiBody: null, url,
      })
    }
    await raiseForStatus(res, url)
    try { return await res.json() } catch { return null }
  },
  inspectLessonFile: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    const url = `${BASE}/api/lessons/inspect`
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        body: fd,
        headers: { ...authHeaders() },
      })
    } catch (networkErr) {
      throw new ApiError({
        message: `Network error: ${networkErr.message || 'could not reach server'}.`,
        status: 0, apiBody: null, url,
      })
    }
    await raiseForStatus(res, url)
    try { return await res.json() } catch { return null }
  },
  inspectLessonText: (text) =>
    request('/api/lessons/inspect', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  pasteLesson: (text, title) =>
    request('/api/lessons/paste', {
      method: 'POST',
      body: JSON.stringify({ text, title: title || null }),
    }),
  aiFillLesson: (topic, existing_text, title = null) =>
    request('/api/lessons/ai-fill', {
      method: 'POST',
      body: JSON.stringify({ topic, existing_text, title }),
    }),
  claimLesson: (lessonId, teacher_username) =>
    request(`/api/lessons/${lessonId}/claim`, {
      method: 'PATCH',
      body: JSON.stringify({ teacher_username }),
    }),
  getPublicLesson: (lessonId) => request(`/api/lessons/${lessonId}/public`),
  listLessons: () => request('/api/lessons'),
  getLesson: (id) => request(`/api/lessons/${id}`),

  // Games
  listGameTypes: () => request('/api/game-types'),
  createGame: (lesson_id, game_type) =>
    request('/api/games', {
      method: 'POST',
      body: JSON.stringify({ lesson_id, game_type }),
    }),
  getGamesByLesson: (lessonId) => request(`/api/games/by-lesson/${lessonId}`),
  getGameFull: (id) => request(`/api/games/${id}/full`),

  // Sessions
  startSession: (game_id, student_id = 'demo_student') =>
    request('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ game_id, student_id }),
    }),
  startStudentSession: ({ game_id, student_name }) =>
    request('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({
        game_id,
        student_id: student_name || 'anon',
        student_name,
      }),
    }),
  postEvent: (event) =>
    request('/api/sessions/event', {
      method: 'POST',
      body: JSON.stringify(event),
    }),
  endSession: (payload) =>
    request('/api/sessions/end', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listReports: () => request('/api/sessions/reports'),
  getReport: (id) => request(`/api/sessions/reports/${id}`),

  // Analytics
  getTeacherSummary: (username) =>
    request(`/api/analytics/teacher/${username}/summary`),
  getLessonLeaderboard: (lessonId) =>
    request(`/api/analytics/lesson/${lessonId}/leaderboard`),
  getLessonBreakdown: (lessonId) =>
    request(`/api/analytics/lesson/${lessonId}/breakdown`),
  getUserActivity: (username) =>
    request(`/api/analytics/user/${username}/activity`),

  // Auth
  register: (username, lesson_id = null) =>
    request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, lesson_id }),
    }),
  signIn: (username, pin) =>
    request('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ username, pin }),
    }),
  signOut: () =>
    request('/api/auth/signout', { method: 'POST' }),
  getMe: () => request('/api/auth/me'),
}
