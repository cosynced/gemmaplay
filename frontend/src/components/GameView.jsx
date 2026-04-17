import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { PhaserGame } from './PhaserGame.jsx'

export function GameView({ gameId, onFinished }) {
  const [game, setGame] = useState(null)
  const [lesson, setLesson] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const full = await api.getGameFull(gameId)
        const session = await api.startSession(gameId)
        if (cancelled) return
        setGame(full.game)
        setLesson(full.lesson)
        setSessionId(session.session_id)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [gameId])

  async function handleEnd(stats) {
    try {
      const report = await api.endSession({
        session_id: sessionId,
        game_id: gameId,
        student_id: 'demo_student',
        time_seconds: stats.time_seconds,
      })
      onFinished(report)
    } catch (e) {
      setError(e.message)
    }
  }

  if (error) {
    return <div className="max-w-xl mx-auto mt-12 p-4 bg-red-50 text-red-700 rounded">{error}</div>
  }
  if (!game || !lesson || !sessionId) {
    return <div className="text-center mt-12 text-slate-500">Loading game...</div>
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-center mb-2 text-slate-700">
        {lesson.title}
      </h2>
      <p className="text-center text-sm text-slate-500 mb-4">
        Use A / B / C / D keys or tap answers
      </p>
      <PhaserGame
        game={game}
        lesson={lesson}
        sessionId={sessionId}
        onSessionEnd={handleEnd}
      />
    </div>
  )
}
