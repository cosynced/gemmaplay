import { useEffect, useState } from 'react'
import { api } from '../api/client.js'

// Signature top-strip colors per game type. Keys match GAME_TYPES[].id from
// the backend. Fall back to slate for anything new the backend adds before
// this map catches up.
const ACCENT_COLORS = {
  lane_runner: 'bg-cyan-500',
  tetris_answer: 'bg-purple-500',
  shooter_answer: 'bg-emerald-500',
  quiz_runner: 'bg-amber-500',
}

export function GamePicker({ lesson, onPicked }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const t = await api.listGameTypes()
        if (!cancelled) setTypes(t)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function handlePick(type) {
    setBusyId(type.id)
    setError(null)
    try {
      const res = await api.createGame(lesson.lesson_id, type.id)
      onPicked(res)
    } catch (e) {
      setError(e.message)
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="text-center mt-12 text-slate-500">Loading game types…</div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto mt-12 px-6">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-semibold text-slate-800">
          Pick a game for “{lesson.title}”
        </h2>
        <p className="text-slate-500 mt-1 text-sm">
          Same lesson, different mechanics. Choose the one your class will
          enjoy most — you can always build another.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {types.map((t) => {
          const accent = ACCENT_COLORS[t.id] || 'bg-slate-500'
          const busy = busyId === t.id
          return (
            <button
              key={t.id}
              disabled={!!busyId}
              onClick={() => handlePick(t)}
              className="group text-left bg-white rounded-xl shadow overflow-hidden border border-slate-200 hover:border-brand-500 hover:shadow-md disabled:opacity-60 transition"
            >
              <div className={`h-2 ${accent}`} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-slate-800">
                    {t.name}
                  </h3>
                  {busy && (
                    <span className="text-xs text-brand-600 font-medium">
                      Building…
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600 mb-3">{t.description}</p>
                <div className="text-xs uppercase tracking-wide text-slate-400 font-medium mb-1">
                  Best for
                </div>
                <p className="text-sm text-slate-500">{t.best_for}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
