// LandingBackground — 4 live Phaser scenes running in autoPlay mode as a
// quadrant backdrop behind the hero. Each quadrant runs a small, throttled
// Phaser.Game; pointer events are disabled so clicks fall through to the
// hero CTAs. Renders on mobile too (2×2 grid, lower fps to save battery).

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

// Per-scene base_speed tuned for a calm, readable backdrop.
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

// Per-quadrant Phaser.Game dimensions match each scene's native design
// size so the scene never has to self-resize mid-create (which was
// shifting the Lane Runner canvas off-screen).
const QUADRANTS = [
  {
    SceneClass: LaneRunnerScene,
    key: 'LaneRunnerScene',
    game: makeGame('landing_bg_lane', 120),
    width: 540,   // portrait
    height: 900,
  },
  {
    SceneClass: TetrisAnswerScene,
    key: 'TetrisAnswerScene',
    game: makeGame('landing_bg_tetris', 18),
    width: 960,
    height: 540,
  },
  {
    SceneClass: ShooterAnswerScene,
    key: 'ShooterAnswerScene',
    game: makeGame('landing_bg_shooter', 8),
    width: 960,
    height: 540,
  },
  {
    SceneClass: SnakeKnowledgeScene,
    key: 'SnakeKnowledgeScene',
    game: makeGame('landing_bg_snake', 0),
    width: 960,
    height: 540,
    tickMs: 520,
  },
]

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < breakpoint
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = (e) => setMobile(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    setMobile(mq.matches)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [breakpoint])
  return mobile
}

export function LandingBackground() {
  const isMobile = useIsMobile(768)
  const containerRefs = useRef(QUADRANTS.map(() => null))
  const gamesRef = useRef([])

  useEffect(() => {
    // Halve the effective tick rate on mobile to save battery. Phaser's
    // `fps.target` throttles the whole loop — scene Time events, autoplay
    // timers, and update() all slow together without touching any scene.
    const targetFps = isMobile ? 12 : 24

    const games = QUADRANTS.map((q, i) => {
      const parent = containerRefs.current[i]
      if (!parent) return null
      const tickMs = q.tickMs != null
        ? (isMobile ? q.tickMs * 2 : q.tickMs)
        : undefined
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        width: q.width,
        height: q.height,
        backgroundColor: '#0c1220',
        scene: [q.SceneClass],
        scale: {
          // ENVELOP fills the quadrant entirely (aspect-preserving, cropping
          // any overflow). FIT would letterbox the portrait Lane Runner
          // inside a landscape quadrant, leaving dead space on the sides.
          // At 25% opacity the crop isn't noticeable for a decorative backdrop.
          mode: Phaser.Scale.ENVELOP,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          parent,
        },
        fps: { target: targetFps, forceSetTimeOut: true },
        input: { keyboard: false, mouse: false, touch: false, activePointers: 0 },
        physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
      })
      game.scene.start(q.key, {
        game: { ...q.game, game_type: q.key },
        lesson: DEMO_LESSON,
        sessionId: `landing_bg_${i}`,
        autoPlay: true,
        tickMs,
        onSessionEnd: () => {},
      })
      return game
    }).filter(Boolean)

    gamesRef.current = games

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
  }, [isMobile])

  return (
    <div
      aria-hidden
      className="absolute inset-0 z-0 grid grid-cols-2 grid-rows-2 pointer-events-none opacity-25"
    >
      {QUADRANTS.map((q) => (
        // `relative overflow-hidden` clips any canvas bleed.
        // The inner wrapper is a flex box so the FIT-scaled canvas is
        // always visually centered in its quadrant even if Phaser's
        // autoCenter margins aren't pixel-perfect for portrait scenes.
        <div key={q.key} className="relative overflow-hidden">
          {/* Inner wrapper is a positioning anchor only — Phaser's ENVELOP
              mode will oversize the canvas to cover and the quadrant's
              `overflow: hidden` does the clipping. */}
          <div
            ref={(el) => {
              const idx = QUADRANTS.findIndex((x) => x.key === q.key)
              containerRefs.current[idx] = el
            }}
            className="absolute inset-0"
          />
        </div>
      ))}
    </div>
  )
}
