import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import {
  getStudentName,
  setStudentName as persistStudentName,
  USERNAME_RE,
} from '../utils/identity.js'
import { ErrorBanner } from './ErrorBanner.jsx'

export function StudentJoinView({ lessonId, onJoined }) {
  const [lesson, setLesson] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState(() => getStudentName() || '')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const l = await api.getPublicLesson(lessonId)
        if (!cancelled) setLesson(l)
      } catch (e) {
        if (!cancelled) { logError(e, { where: 'getPublicLesson' }); setError(e) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [lessonId])

  useEffect(() => {
    inputRef.current?.focus()
  }, [lesson])

  function submit(e) {
    e?.preventDefault?.()
    const trimmed = name.trim()
    if (!USERNAME_RE.test(trimmed)) {
      setError(new Error('Use 2 to 24 letters, numbers, or underscore.'))
      return
    }
    setBusy(true)
    persistStudentName(trimmed)
    onJoined({ lesson, student_name: trimmed })
  }

  return (
    <section className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16 min-h-[calc(100vh-140px)] flex items-start sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-xl mx-auto w-full"
      >
        <div className="text-center mb-8">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Play invite
          </div>
          <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-bold">
            {lesson ? "You've been invited to play:" : 'Loading lesson…'}
          </h2>
          {lesson && (
            <p className="mt-3 text-lg sm:text-xl md:text-2xl text-slate-200 font-medium break-words">
              {lesson.title}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-6">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        {lesson && (
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
            className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5 sm:p-6 md:p-8"
          >
            <label className="block text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">
              Your name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="jordan92"
              disabled={busy}
              className="w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 disabled:opacity-60"
            />
            <div className="mt-1 text-xs text-slate-500">
              2 to 24 chars · letters, numbers, underscore
            </div>

            <motion.button
              type="submit"
              whileHover={!busy ? { scale: 1.03 } : undefined}
              whileTap={!busy ? { scale: 0.97 } : undefined}
              disabled={busy}
              className="mt-6 w-full px-8 py-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-lg shadow-lg shadow-brand-500/30 disabled:opacity-60"
            >
              Join and pick a game
            </motion.button>
          </motion.form>
        )}
      </motion.div>
    </section>
  )
}
