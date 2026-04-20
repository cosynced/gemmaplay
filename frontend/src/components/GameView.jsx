import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import { PhaserGame } from './PhaserGame.jsx'
import { ErrorBanner } from './ErrorBanner.jsx'
import { NavigationConfirmModal } from './NavigationConfirmModal.jsx'
import { clearGameState } from '../utils/gameStatePersist.js'
import { useNavGuardApi } from '../App.jsx'

export function GameView({ gameId, onFinished, studentName }) {
  const [game, setGame] = useState(null)
  const [lesson, setLesson] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [error, setError] = useState(null)
  const [pendingNav, setPendingNav] = useState(null)
  const endedRef = useRef(false)
  const { setGuard, clearGuard } = useNavGuardApi()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const full = await api.getGameFull(gameId)
        const session = studentName
          ? await api.startStudentSession({ game_id: gameId, student_name: studentName })
          : await api.startSession(gameId)
        if (cancelled) return
        setGame(full.game)
        setLesson(full.lesson)
        setSessionId(session.session_id)
      } catch (e) {
        if (!cancelled) {
          logError(e, { where: 'GameView.load', gameId, studentName })
          setError(e)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [gameId, studentName])

  // Browser-level guard: reload, close tab, navigate externally.
  useEffect(() => {
    function onBeforeUnload(e) {
      if (endedRef.current) return
      e.preventDefault()
      // Modern browsers ignore custom strings but require assignment.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // In-app guard: intercept router-based nav via the NavGuard context.
  useEffect(() => {
    setGuard((_to, proceed) => {
      if (endedRef.current) { proceed(); return }
      setPendingNav(() => proceed)
    })
    return () => clearGuard()
  }, [setGuard, clearGuard])

  async function handleEnd(stats) {
    endedRef.current = true
    try { clearGameState(gameId) } catch { /* ignore */ }
    try {
      const report = await api.endSession({
        session_id: sessionId,
        game_id: gameId,
        student_id: studentName || 'demo_student',
        time_seconds: stats.time_seconds,
        score: stats.score ?? 0,
        questions_answered: stats.questions_answered ?? 0,
        questions_correct: stats.questions_correct ?? 0,
        max_streak: stats.max_streak ?? 0,
      })
      onFinished(report, stats)
    } catch (e) {
      logError(e, { where: 'endSession', gameId, sessionId })
      setError(e)
    }
  }

  if (error) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
        <div className="max-w-xl mx-auto">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
      </div>
    )
  }
  if (!game || !lesson || !sessionId) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-10 py-16 sm:py-20 text-center text-slate-400 text-sm">
        Loading game…
      </div>
    )
  }

  return (
    <section className="w-full px-2 sm:px-6 md:px-10 py-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-6xl mx-auto"
      >
        <div className="text-center mb-4 sm:mb-6">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Now playing
          </div>
          <h2 className="mt-1 text-xl sm:text-2xl md:text-3xl font-bold text-slate-100 break-words px-2">
            {lesson.title}
          </h2>
          <p className="mt-2 text-[11px] sm:text-xs uppercase tracking-wider text-slate-500">
            Arrow keys · WASD · A / B / C / D · or swipe
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className={
            game.game_type === 'lane_runner'
              // Portrait 540:900 frame. Mobile: width fills viewport,
              // height derived from aspect. Desktop: height dominates
              // (min of 85vh / 900px), width derived from aspect.
              ? 'mx-auto rounded-xl sm:rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/60 p-1 sm:p-3 shadow-2xl shadow-brand-500/10 w-full max-w-[540px] aspect-[540/900] md:w-auto md:h-[min(85vh,900px)]'
              : 'rounded-xl sm:rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/60 p-1 sm:p-3 shadow-2xl shadow-brand-500/10'
          }
        >
          <PhaserGame
            game={game}
            lesson={lesson}
            sessionId={sessionId}
            onSessionEnd={handleEnd}
          />
        </motion.div>
      </motion.div>

      {pendingNav && (
        <NavigationConfirmModal
          onCancel={() => setPendingNav(null)}
          onLeave={() => {
            const fn = pendingNav
            setPendingNav(null)
            fn?.()
          }}
        />
      )}
    </section>
  )
}
