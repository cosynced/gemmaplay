import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import { getTeacherUsername } from '../utils/identity.js'
import { ShareLink } from './ShareLink.jsx'
import { ErrorBanner } from './ErrorBanner.jsx'

const GAME_TYPE_LABEL = {
  lane_runner: 'Lane Runner',
  tetris_answer: 'Answer Stacker',
  shooter_answer: 'Answer Blaster',
  snake_knowledge: 'Snake Knowledge',
  quiz_runner: 'Classic Quiz',
}

const GAME_TYPE_ACCENT = {
  lane_runner: '#0ea5e9',
  tetris_answer: '#a855f7',
  shooter_answer: '#facc15',
  snake_knowledge: '#10b981',
  quiz_runner: '#facc15',
}

export function TeacherDashboard({ signedIn = true, onRequestSignIn, onSignOut }) {
  const teacher = getTeacherUsername()
  const [activity, setActivity] = useState([])
  const [summary, setSummary] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { if (signedIn && teacher) refresh() }, [signedIn, teacher])

  if (!signedIn) {
    return (
      <section className="w-full px-4 sm:px-6 md:px-10 py-16 sm:py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-md mx-auto rounded-2xl bg-slate-900/60 border border-slate-800 p-6 sm:p-8 text-center"
        >
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Dashboard
          </div>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold">
            Sign in to view your dashboard.
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            Your activity, leaderboards, and student reports live behind a
            6-digit login.
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onRequestSignIn?.()}
            className="mt-6 w-full px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30"
          >
            Sign in
          </motion.button>
        </motion.div>
      </section>
    )
  }

  async function refresh() {
    setError(null)
    if (!teacher) { setActivity([]); setSummary(null); return }
    try {
      const [a, s] = await Promise.all([
        api.getUserActivity(teacher),
        api.getTeacherSummary(teacher),
      ])
      setActivity(a)
      setSummary(s)
    } catch (e) {
      logError(e, { where: 'TeacherDashboard.refresh' })
      setError(e)
    }
  }

  return (
    <section className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-6xl mx-auto"
      >
        {onSignOut && (
          <div className="flex justify-end mb-4 sm:mb-6">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onSignOut}
              className="px-4 py-2 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-300 text-xs sm:text-sm font-semibold hover:bg-slate-800"
            >
              Sign out
            </motion.button>
          </div>
        )}
        <div className="text-center mb-8 sm:mb-12">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Your space
          </div>
          <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-bold">
            Dashboard
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400 max-w-xl mx-auto px-2">
            {teacher
              ? <>Everything tagged with <span className="text-brand-500 font-semibold">@{teacher}</span>, created and played.</>
              : <>Create a game or join a shared one to see activity here.</>}
          </p>
        </div>

        {error && (
          <div className="mb-6">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        {teacher && (
          <SummaryCards summary={summary} />
        )}

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          className="mt-10 sm:mt-12"
        >
          <div className="flex items-baseline justify-between mb-5">
            <h3 className="text-lg sm:text-xl font-semibold">Your activity</h3>
            <span className="text-xs uppercase tracking-widest text-slate-500">
              {activity.length} total
            </span>
          </div>
          {activity.length === 0 ? (
            <EmptyState>
              Nothing here yet. Create a game or play a shared one to see
              activity.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {activity.map((item, i) => {
                const key = `${item.type}:${item.lesson_id}:${item.timestamp}`
                return (
                  <ActivityRow
                    key={key}
                    item={item}
                    delay={i * 0.05}
                    expanded={expandedKey === key}
                    onToggle={() => setExpandedKey(
                      expandedKey === key ? null : key,
                    )}
                  />
                )
              })}
            </div>
          )}
        </motion.section>
      </motion.div>
    </section>
  )
}

function SummaryCards({ summary }) {
  const cards = useMemo(() => {
    const s = summary || {}
    return [
      { label: 'Games',           value: s.games_count ?? 0 },
      { label: 'Plays',           value: s.plays_count ?? 0 },
      { label: 'Unique students', value: s.unique_students ?? 0 },
      { label: 'Avg score',       value: s.avg_score != null ? `${s.avg_score}` : '—' },
    ]
  }, [summary])
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.05, ease: 'easeOut' }}
          className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800"
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            {c.label}
          </div>
          <div className="mt-2 text-3xl font-bold text-slate-100">{c.value}</div>
        </motion.div>
      ))}
    </div>
  )
}

function formatTimestamp(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000)
  if (dayDiff === 0) {
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return `today at ${time}`
  }
  if (dayDiff === 1) return 'yesterday'
  if (dayDiff > 1 && dayDiff < 7) {
    return date.toLocaleDateString([], { weekday: 'long' }).toLowerCase()
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function TypeBadge({ type }) {
  if (type === 'created') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
        Created
      </span>
    )
  }
  if (type === 'student_played') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/40">
        Student play
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">
      Played
    </span>
  )
}

function ActivityRow({ item, expanded, onToggle, delay = 0 }) {
  const meta = [
    item.type === 'student_played' && item.student_name ? `@${item.student_name}` : null,
    item.lesson_subject,
    formatTimestamp(item.timestamp),
  ].filter(Boolean).join(' · ')
  const isPlay = item.type === 'played' || item.type === 'student_played'
  const showScoreLine = isPlay && item.completed && item.score != null
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className="rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 overflow-hidden"
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-5 flex items-start gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <TypeBadge type={item.type} />
            {meta && (
              <div className="text-xs uppercase tracking-widest text-slate-500">
                {meta}
              </div>
            )}
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-100 truncate">
            {item.lesson_title}
          </div>
          {showScoreLine && (
            <div className="mt-1 text-sm text-slate-400">
              Score: {item.score}
              {item.total_questions ? `/${item.total_questions}` : ''}
            </div>
          )}
        </div>
        <span className="text-slate-500 text-sm select-none mt-1">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            {item.type === 'created'
              ? <LessonDetail lessonId={item.lesson_id} />
              : <PlayedDetail item={item} isStudentPlay={item.type === 'student_played'} />}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function PlayedDetail({ item, isStudentPlay = false }) {
  function playAgain() {
    if (typeof window !== 'undefined' && item.lesson_id) {
      window.location.assign(`/play/${item.lesson_id}`)
    }
  }
  const gameLabel = GAME_TYPE_LABEL[item.game_type] || item.game_type || 'Unknown game'
  return (
    <div className="border-t border-slate-800 p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {isStudentPlay && (
          <Stat label="Student" value={item.student_name ? `@${item.student_name}` : '—'} />
        )}
        <Stat
          label="Score"
          value={
            item.completed && item.score != null
              ? `${item.score}${item.total_questions ? `/${item.total_questions}` : ''}`
              : '—'
          }
        />
        <Stat label="Game" value={gameLabel} />
        <Stat
          label="Status"
          value={item.completed ? 'Completed' : 'Not finished'}
        />
      </div>
      {!isStudentPlay && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={playAgain}
          className="w-full px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30"
        >
          Play again
        </motion.button>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-100 truncate">
        {value}
      </div>
    </div>
  )
}

function LessonDetail({ lessonId }) {
  const [games, setGames] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [breakdown, setBreakdown] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [g, lb, bd] = await Promise.all([
          api.getGamesByLesson(lessonId),
          api.getLessonLeaderboard(lessonId),
          api.getLessonBreakdown(lessonId),
        ])
        if (!cancelled) {
          setGames(g)
          setLeaderboard(lb)
          setBreakdown(bd)
        }
      } catch (e) {
        logError(e, { where: 'LessonDetail.load', lessonId })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [lessonId])

  return (
    <div className="border-t border-slate-800 p-4 sm:p-6 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
          Share link
        </div>
        <ShareLink lessonId={lessonId} />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs uppercase tracking-widest text-slate-500">Games</div>
          <div className="text-xs text-slate-500">{games.length}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {games.map((g) => (
            <div
              key={g.game_id}
              className="rounded-xl bg-slate-950/60 border border-slate-800 overflow-hidden"
            >
              <div className="h-1.5" style={{ backgroundColor: GAME_TYPE_ACCENT[g.game_type] || '#64748b' }} />
              <div className="p-3 text-sm font-semibold text-slate-200 truncate">
                {GAME_TYPE_LABEL[g.game_type] || g.game_type}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs uppercase tracking-widest text-slate-500">Leaderboard</div>
          <div className="text-xs text-slate-500">
            Top {Math.min(10, leaderboard.length)}
          </div>
        </div>
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : leaderboard.length === 0 ? (
          <EmptyState>No plays yet.</EmptyState>
        ) : (
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 divide-y divide-slate-800 overflow-hidden">
            {leaderboard.map((e, i) => (
              <div key={`${e.student_name}-${i}`} className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3">
                <div className="text-xs text-slate-500 w-5 shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-200">
                  @{e.student_name}
                </div>
                <div className="hidden sm:block text-xs text-slate-500 shrink-0">{e.time_seconds}s</div>
                <div className="hidden sm:block text-xs text-slate-500 shrink-0">{e.hints_used} hints</div>
                <div className="sm:hidden text-[10px] text-slate-500 shrink-0 text-right leading-tight">
                  <div>{e.time_seconds}s</div>
                  <div>{e.hints_used} hints</div>
                </div>
                <div className="text-sm font-semibold text-emerald-300 w-12 sm:w-14 text-right shrink-0">
                  {e.score}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownList
          title="Most mastered"
          items={breakdown?.concepts_most_mastered || []}
          tone="emerald"
          loading={loading}
        />
        <BreakdownList
          title="Weakest"
          items={breakdown?.concepts_weakest || []}
          tone="amber"
          loading={loading}
        />
      </div>
    </div>
  )
}

function BreakdownList({ title, items, tone, loading }) {
  const color =
    tone === 'emerald'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
      : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">{title}</div>
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState>Not enough plays yet.</EmptyState>
      ) : (
        <ul className="rounded-xl bg-slate-950/60 border border-slate-800 divide-y divide-slate-800">
          {items.map((it) => (
            <li key={it.concept_id} className="flex items-center gap-3 px-4 py-3">
              <span className={`text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border ${color}`}>
                {Math.round(it.mastery_rate * 100)}%
              </span>
              <span className="text-sm text-slate-200 truncate">{it.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyState({ children }) {
  return (
    <div className="rounded-xl bg-slate-900/40 border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}
