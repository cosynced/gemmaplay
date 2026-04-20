import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import { ErrorBanner } from './ErrorBanner.jsx'

// Per-game-type hex accents matching the landing page's "Four ways to play"
// section exactly. Unknown ids fall back to slate.
const ACCENTS = {
  lane_runner: '#0ea5e9',
  tetris_answer: '#a855f7',
  shooter_answer: '#facc15',
  snake_knowledge: '#10b981',
  quiz_runner: '#facc15',
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
        if (!cancelled) { logError(e, { where: 'listGameTypes' }); setError(e) }
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
      logError(e, { where: 'createGame', lesson_id: lesson.lesson_id, game_type: type.id })
      setError(e)
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-10 py-16 sm:py-20 text-center text-slate-400 text-sm">
        Loading game types…
      </div>
    )
  }

  return (
    <section className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-6xl mx-auto"
      >
        <div className="text-center mb-8 sm:mb-10">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Step 2 · Pick a game
          </div>
          <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-bold">
            Same lesson. <span className="text-slate-400 font-medium">Different mechanics.</span>
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400 max-w-xl mx-auto">
            “{lesson.title}”. Pick the game your class will enjoy most. You can always build another.
          </p>
        </div>

        {error && (
          <div className="mb-6 max-w-3xl mx-auto">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {types.map((t, i) => {
            const accent = ACCENTS[t.id] || '#64748b'
            const busy = busyId === t.id
            const disabled = !!busyId
            return (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: 'easeOut' }}
                whileHover={disabled ? undefined : {
                  scale: 1.03,
                  y: -4,
                  boxShadow: '0 20px 40px -12px rgba(14,165,233,0.25)',
                }}
                whileTap={disabled ? undefined : { scale: 0.98 }}
                disabled={disabled}
                onClick={() => handlePick(t)}
                className={`relative text-left rounded-2xl overflow-hidden bg-slate-900/60 border border-slate-800 hover:border-slate-700 disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div
                  className="absolute top-0 left-0 right-0 h-2 rounded-t-2xl"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                />
                <div className="p-6 pt-7">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold text-slate-100">{t.name}</h3>
                    {busy && (
                      <span className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
                        Building…
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                    {t.description}
                  </p>
                  <p className="mt-4 text-xs uppercase tracking-wider text-slate-500">Best for</p>
                  <p className="text-sm text-slate-300">{t.best_for}</p>
                </div>
              </motion.button>
            )
          })}
        </div>
      </motion.div>
    </section>
  )
}
