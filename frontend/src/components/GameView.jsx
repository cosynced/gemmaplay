import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import { getTeacherUsername } from '../utils/identity.js'
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
        // Creator flow (no studentName prop): tag the session with the
        // cached teacher username so self-play detection works and the
        // report switches to second-person narrative.
        const creatorName = studentName ? null : getTeacherUsername()
        const session = studentName
          ? await api.startStudentSession({ game_id: gameId, student_name: studentName })
          : await api.startSession(gameId, 'demo_student', creatorName)
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

  const isLaneRunner = game.game_type === 'lane_runner'

  return (
    // Flex column that fills the viewport. The header is shrink-to-content
    // so the canvas wrapper gets all remaining vertical space via flex-1,
    // and the canvas's internal Phaser.Scale.FIT stays aspect-locked within.
    // 100dvh handles mobile URL-bar show/hide (falls back to 100vh in CSS).
    <section
      className="w-full px-1 sm:px-6 md:px-10 py-1 sm:py-6 flex flex-col"
      style={{
        minHeight: '100dvh',
        // Fallback for older browsers that don't support dvh: still give
        // the section a full-viewport height so flex-1 children can expand.
        ['--mvh']: '100vh',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-6xl mx-auto flex-1 min-h-0 flex flex-col"
      >
        <div className="text-center mb-1 sm:mb-4 shrink-0">
          <div className="hidden sm:block text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Now playing
          </div>
          <h2 className="text-sm sm:text-2xl md:text-3xl font-semibold sm:font-bold text-slate-100 break-words px-2 line-clamp-1 sm:line-clamp-none leading-tight">
            {lesson.title}
          </h2>
          <p className="hidden sm:block mt-2 text-[11px] sm:text-xs uppercase tracking-wider text-slate-500">
            Arrow keys · WASD · A / B / C / D · or swipe
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className={
            isLaneRunner
              // Portrait 540:900. Mobile + desktop both center and
              // aspect-lock; flex-1 lets the canvas use all remaining
              // vertical space, capped at 900px on big screens.
              ? 'mx-auto rounded-xl sm:rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/60 p-0 sm:p-3 shadow-2xl shadow-brand-500/10 flex-1 min-h-0 w-full max-w-[540px] aspect-[540/900] max-h-[min(100%,900px)]'
              // Landscape 16:9. Mobile: canvas takes full viewport
              // width with 16:9 letterbox; flex-1 pushes the wrapper
              // to fill remaining vertical space, but aspect-ratio
              // caps the actual canvas box so Phaser FIT scales
              // correctly. Desktop: capped at 1200px wide, centered.
              : 'mx-auto rounded-xl sm:rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/60 p-0 sm:p-3 shadow-2xl shadow-brand-500/10 flex-1 min-h-0 w-full max-w-[1200px] flex items-center justify-center'
          }
        >
          {isLaneRunner ? (
            <PhaserGame
              game={game}
              lesson={lesson}
              sessionId={sessionId}
              onSessionEnd={handleEnd}
            />
          ) : (
            // Aspect-locked inner box so Phaser FIT has a 16:9 bounding
            // rect to measure; without this the flex parent can be any
            // shape and FIT would pick an ugly scale.
            <div className="w-full aspect-[16/9] max-h-full">
              <PhaserGame
                game={game}
                lesson={lesson}
                sessionId={sessionId}
                onSessionEnd={handleEnd}
              />
            </div>
          )}
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
