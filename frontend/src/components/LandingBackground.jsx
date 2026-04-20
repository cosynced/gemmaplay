// LandingBackground — 4 live Phaser scenes running in autoPlay mode as a
// quadrant backdrop behind the hero. Each quadrant runs a small, throttled
// Phaser.Game; pointer events are disabled so clicks fall through to the
// hero CTAs. On screens <768px, we skip Phaser entirely and render a
// static gradient.

import { useEffect, useRef, useState } from 'react'
import Phaser from '../scenes/phaser-global.js'
import { LaneRunnerScene } from '../scenes/LaneRunnerScene.js'
import { TetrisAnswerScene } from '../scenes/TetrisAnswerScene.js'
import { ShooterAnswerScene } from '../scenes/ShooterAnswerScene.js'
import { SnakeKnowledgeScene } from '../scenes/SnakeKnowledgeScene.js'

const DEMO_LESSON = {
  concepts: [
    {
      id: 'bg_c1',
      name: 'The Sun',
      questions: [
        {
          id: 'bg_q1',
          q: 'What star sits at the center of our solar system?',
          options: ['The Moon', 'The Sun', 'Earth', 'Mars'],
          answer_index: 1,
        },
        {
          id: 'bg_q2',
          q: 'The Sun mostly gives us...?',
          options: ['Rain', 'Light & heat', 'Wind', 'Metal'],
          answer_index: 1,
        },
      ],
    },
    {
      id: 'bg_c2',
      name: 'Photosynthesis',
      questions: [
        {
          id: 'bg_q3',
          q: 'Plants absorb which gas for photosynthesis?',
          options: ['Oxygen', 'Helium', 'Carbon dioxide', 'Argon'],
          answer_index: 2,
        },
        {
          id: 'bg_q4',
          q: 'Main sugar produced by photosynthesis?',
          options: ['Salt', 'Glucose', 'Stone', 'Protein'],
          answer_index: 1,
        },
      ],
    },
  ],
}

// Per-scene base_speed tuned for a calm, readable backdrop. Each scene
// interprets base_speed in its own units:
//   LaneRunner: scroll px/sec (default 300)
//   Tetris:     fall  px/sec (default 40)
//   Shooter:    descent px/sec (default 20)
//   Snake:      doesn't read base_speed; we pass tickMs instead.
function makeGame(gameId, baseSpeed) {
  return {
    game_id: gameId,
    lesson_id: 'landing_bg_lesson',
    levels: [
      { concept_id: 'bg_c1', base_speed: baseSpeed, questions: ['bg_q1', 'bg_q2'] },
      { concept_id: 'bg_c2', base_speed: baseSpeed, questions: ['bg_q3', 'bg_q4'] },
    ],
  }
}

const QUADRANTS = [
  {
    SceneClass: LaneRunnerScene,
    key: 'LaneRunnerScene',
    game: makeGame('landing_bg_lane', 120),
  },
  {
    SceneClass: TetrisAnswerScene,
    key: 'TetrisAnswerScene',
    game: makeGame('landing_bg_tetris', 18),
  },
  {
    SceneClass: ShooterAnswerScene,
    key: 'ShooterAnswerScene',
    game: makeGame('landing_bg_shooter', 8),
  },
  {
    SceneClass: SnakeKnowledgeScene,
    key: 'SnakeKnowledgeScene',
    game: makeGame('landing_bg_snake', 0),
    tickMs: 520,
  },
]

function useWideScreen(breakpoint = 768) {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= breakpoint
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const onChange = (e) => setWide(e.matches)
    // Safari <14 doesn't support addEventListener on MQL
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    setWide(mq.matches)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [breakpoint])
  return wide
}

export function LandingBackground() {
  const wide = useWideScreen(768)
  const containerRefs = useRef(QUADRANTS.map(() => null))
  const gamesRef = useRef([])

  useEffect(() => {
    if (!wide) return

    const games = QUADRANTS.map((q, i) => {
      const parent = containerRefs.current[i]
      if (!parent) return null
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        width: 960,
        height: 540,
        backgroundColor: '#0c1220',
        scene: [q.SceneClass],
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          parent,
        },
        fps: { target: 24, forceSetTimeOut: true },
        // Disable input entirely — backdrop is non-interactive.
        input: { keyboard: false, mouse: false, touch: false, activePointers: 0 },
        physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
      })
      game.scene.start(q.key, {
        game: { ...q.game, game_type: q.key },
        lesson: DEMO_LESSON,
        sessionId: `landing_bg_${i}`,
        autoPlay: true,
        tickMs: q.tickMs,
        onSessionEnd: () => {}, // never fires in autoPlay
      })
      return game
    }).filter(Boolean)

    gamesRef.current = games

    // Pause the render/update loops when the tab is hidden.
    const pauseAll = () => {
      for (const g of gamesRef.current) {
        try { g.loop && g.loop.sleep && g.loop.sleep() } catch { /* ignore */ }
      }
    }
    const resumeAll = () => {
      for (const g of gamesRef.current) {
        try { g.loop && g.loop.wake && g.loop.wake() } catch { /* ignore */ }
      }
    }
    const onVis = () => (document.hidden ? pauseAll() : resumeAll())
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      for (const g of games) {
        try { g.destroy(true) } catch { /* ignore */ }
      }
      gamesRef.current = []
    }
  }, [wide])

  if (!wide) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-br from-sky-900/40 via-slate-950 to-violet-900/40"
      />
    )
  }

  return (
    <div
      aria-hidden
      className="absolute inset-0 z-0 grid grid-cols-2 grid-rows-2 pointer-events-none opacity-25"
    >
      {QUADRANTS.map((q, i) => (
        <div key={q.key} className="relative overflow-hidden">
          <div
            ref={(el) => { containerRefs.current[i] = el }}
            className="w-full h-full"
          />
        </div>
      ))}
    </div>
  )
}
