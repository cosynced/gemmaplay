// Thin API client. Uses Vite proxy in dev; VITE_API_BASE in prod.
const BASE = import.meta.env.VITE_API_BASE || ''

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  // Lessons
  uploadLesson: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/api/lessons`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    return res.json() // { lesson_id, title, concepts }
  },
  listLessons: () => request('/api/lessons'),
  getLesson: (id) => request(`/api/lessons/${id}`),

  // Games
  listGameTypes: () => request('/api/game-types'),
  createGame: (lesson_id, game_type) =>
    request('/api/games', {
      method: 'POST',
      body: JSON.stringify({ lesson_id, game_type }),
    }),
  getGameFull: (id) => request(`/api/games/${id}/full`),

  // Sessions
  startSession: (game_id, student_id = 'demo_student') =>
    request('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ game_id, student_id }),
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
}
