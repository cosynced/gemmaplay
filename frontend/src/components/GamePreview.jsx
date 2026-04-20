import { motion } from 'framer-motion'
import { GameTranscript } from './GameTranscript.jsx'

// Per-game-type "Ready?" content. The top-level keys are GameTypeId values
// from the backend; keep them in sync with backend/app/models/schemas.py.
const PREVIEWS = {
  lane_runner: {
    title: 'Lane Runner',
    accent: '#0ea5e9',
    tagline: 'Read the grid, steer into the lane with the right letter.',
    Visual: LaneRunnerVisual,
    rules: [
      'Read the question and the 4 answer options at top.',
      'Lanes are labeled A, B, C, D. Each lane is a single letter gate.',
      'Steer your runner into the lane matching the correct answer.',
      "Correct: +2 points. Wrong: -1. You start at 20. Hit 0 and it's over.",
    ],
    controls: [
      'Keyboard: Left / Right arrows or A / D. Up arrow or W to commit.',
      'Touch: Swipe left / right, or tap the left / right side of the screen. Swipe up to commit your answer.',
    ],
  },
  tetris_answer: {
    title: 'Answer Stacker',
    accent: '#a855f7',
    tagline: 'Plain block falls. Steer into the bin with the correct answer.',
    Visual: TetrisVisual,
    rules: [
      'Read the question and the 4 options at the top.',
      'Steer the falling block into the bin with the correct letter.',
      'Correct: bin row stays on the floor (or drops back if it was up).',
      'Wrong: bin row shifts up toward the question area.',
      'Game over when the bin row reaches the top.',
    ],
    controls: [
      'Keyboard: Left / Right arrow keys, Down to hard-drop',
      'Touch: Tap a column to snap, swipe left / right, swipe down to drop',
    ],
  },
  shooter_answer: {
    title: 'Answer Blaster',
    accent: '#facc15',
    tagline: 'Shoot the letter that matches the answer.',
    Visual: ShooterVisual,
    rules: [
      'Letters (A/B/C/D) descend toward your ship.',
      'Shoot the letter that matches the correct answer.',
      'Let wrong letters pass. Getting hit by any letter costs a heart.',
    ],
    controls: [
      'Keyboard: Left / Right arrows, Spacebar to shoot',
      'Touch: Tap screen to move + shoot',
    ],
  },
  snake_knowledge: {
    title: 'Snake Knowledge',
    accent: '#10b981',
    tagline: 'Eat the correct answer. Grow. Keep going.',
    Visual: SnakeVisual,
    rules: [
      'Move the snake to eat the food tile labeled with the correct answer.',
      'Correct food = grow + score. Wrong food = shrink.',
      'Hit a wall or yourself = game over.',
      'The correct answer is NOT highlighted. Read the question and know your stuff.',
    ],
    controls: [
      'Keyboard: Arrow keys or WASD',
      'Touch: Swipe in any direction',
    ],
  },
  // Legacy quiz_runner — use the lane runner preview as the nearest match.
  quiz_runner: {
    title: 'Quiz Runner',
    accent: '#facc15',
    tagline: 'Steer into the door with the right answer.',
    Visual: LaneRunnerVisual,
    rules: [
      'Four doors appear; steer into the one matching the correct answer.',
      'Wrong door = lose a heart.',
    ],
    controls: [
      'Keyboard: 1 / 2 / 3 / 4 or A / B / C / D',
      'Touch: Tap the door you want',
    ],
  },
}

export function GamePreview({ gameType, lesson, onStart, onBack }) {
  const preview = PREVIEWS[gameType] || PREVIEWS.lane_runner
  const Visual = preview.Visual
  const notes = lesson?.concept_notes || ''
  const hasNotes = notes.trim().length > 0

  return (
    <section className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="max-w-3xl mx-auto"
      >
        <div className="text-center mb-8">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Ready?
          </div>
          <h2
            className="mt-2 text-3xl sm:text-4xl font-bold"
            style={{ color: preview.accent }}
          >
            {preview.title}
          </h2>
          <p className="mt-2 text-slate-400">{preview.tagline}</p>
        </div>

        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div
            className="flex items-center justify-center px-6 py-6 sm:py-8 bg-slate-950/60"
            style={{ borderBottom: `2px solid ${preview.accent}` }}
          >
            <Visual accent={preview.accent} className="w-full max-w-md h-32 sm:h-40" />
          </div>

          <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                How it works
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200 leading-relaxed">
                {preview.rules.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-[7px] h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: preview.accent }}
                    />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Controls
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200 leading-relaxed">
                {preview.controls.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-[7px] h-1.5 w-1.5 rounded-full flex-shrink-0 bg-slate-500"
                    />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {hasNotes && (
          <div className="mt-6">
            <GameTranscript notes={notes} title={lesson?.title} />
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onBack}
            className="flex-1 sm:flex-none sm:min-w-[180px] px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm"
          >
            Back to picker
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onStart}
            className="flex-1 px-6 py-4 rounded-xl text-white font-semibold text-base sm:text-lg shadow-lg"
            style={{
              backgroundColor: preview.accent,
              boxShadow: `0 10px 30px -10px ${preview.accent}88`,
            }}
          >
            Start game
          </motion.button>
        </div>
      </motion.div>
    </section>
  )
}

// ---------- Visuals ----------
// Each is a small purely-decorative SVG sized via viewBox so it scales to
// the parent. Stroke/accent color comes from `accent` for consistency.

function LaneRunnerVisual({ accent, className }) {
  // 2×2 answer grid up top + 4-lane perspective road with letter gates.
  const colors = ['#0ea5e9', '#a855f7', '#f59e0b', '#10b981']
  const letters = ['A', 'B', 'C', 'D']

  // Grid cells (top band).
  const gridCell = (i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const w = 140
    const h = 22
    const gap = 6
    const x = 14 + col * (w + gap)
    const y = 6 + row * (h + gap)
    return { x, y, w, h }
  }

  // Road trapezoid.
  const cx = 160
  const horizonY = 64
  const baseY = 118
  const halfTop = 30
  const halfBot = 120
  const trap = `${cx - halfTop},${horizonY} ${cx + halfTop},${horizonY} ${cx + halfBot},${baseY} ${cx - halfBot},${baseY}`

  // 3 dashed dividers.
  const dividerLine = (d) => {
    const topX = cx + (d * halfTop * 2 / 4)
    const botX = cx + (d * halfBot * 2 / 4)
    return (
      <line key={`div${d}`} x1={topX} y1={horizonY} x2={botX} y2={baseY}
        stroke="#fbbf24" strokeWidth="1.3" strokeDasharray="4 4" strokeOpacity="0.9" />
    )
  }

  // 4 letter gates at t≈0.35.
  const gateT = 0.35
  const gateY = horizonY + (baseY - horizonY) * gateT
  const gateHalfW = halfTop + (halfBot - halfTop) * gateT
  const laneW = (gateHalfW * 2) / 4
  const gateW = laneW * 0.78
  const gateH = 14

  // Runner in lane 1 (B) at bottom.
  const runnerLaneW = (halfBot * 2) / 4
  const runnerX = cx + (1 - 1.5) * runnerLaneW

  return (
    <svg viewBox="0 0 320 120" className={className} role="img"
      aria-label="2 by 2 answer grid at top and 4-lane road with lettered gates below">
      <rect x="0" y="0" width="320" height="120" fill="#1b2430" />

      {/* 2×2 option grid */}
      {letters.map((l, i) => {
        const { x, y, w, h } = gridCell(i)
        return (
          <g key={l}>
            <rect x={x} y={y} width={w} height={h} rx="4"
              fill="#0f172a" stroke={colors[i]} strokeWidth="1.8" />
            <rect x={x + 3} y={y + 3} width="16" height={h - 6} rx="3" fill={colors[i]} />
            <text x={x + 11} y={y + h / 2 + 3} fontSize="9"
              fontFamily="Inter, sans-serif" fontWeight="700"
              fill="#0c1220" textAnchor="middle">{l}</text>
            <rect x={x + 24} y={y + h / 2 - 3} width={w - 32} height="6" rx="1" fill="#334155" />
          </g>
        )
      })}

      {/* road surface */}
      <polygon points={trap} fill="#3a3a3a" stroke="#ffffff" strokeWidth="1.2" />
      {[-1, 0, 1].map(dividerLine)}

      {/* letter gates */}
      {letters.map((l, i) => {
        const gx = cx + (i - 1.5) * laneW
        return (
          <g key={`gate-${l}`}>
            <rect x={gx - gateW / 2} y={gateY - gateH} width={gateW} height={gateH}
              rx="2" fill={colors[i]} fillOpacity="0.9" stroke="#ffffff" strokeWidth="0.6" />
            <text x={gx} y={gateY - gateH / 2 + 3} fontSize="9"
              fontFamily="Inter, sans-serif" fontWeight="800"
              fill="#ffffff" textAnchor="middle">{l}</text>
          </g>
        )
      })}

      {/* runner */}
      <circle cx={runnerX} cy={baseY - 12} r="3" fill="#38bdf8" />
      <rect x={runnerX - 4} y={baseY - 9} width="8" height="8" rx="2" fill={accent} />
    </svg>
  )
}

function TetrisVisual({ className }) {
  // Light gray background, dark-slate decorative grid, one cell-sized cyan
  // block falling above 4 letter-only bins resting on the bottom row.
  const bins = [
    { stroke: '#0ea5e9', letter: 'A' },
    { stroke: '#a855f7', letter: 'B' },
    { stroke: '#f59e0b', letter: 'C' },
    { stroke: '#10b981', letter: 'D' },
  ]
  const binW = 68
  const binX = (i) => 20 + i * 75
  const cellSize = 14
  const gridLeft = 20
  const gridTop = 8
  const cols = 20
  const rows = 6
  const blockCol = 1
  return (
    <svg viewBox="0 0 320 120" className={className} role="img" aria-label="Cyan block falling toward four letter bins on a light gray grid">
      <rect x="0" y="0" width="320" height="120" fill="#d1d5db" />

      {/* decorative dark-cell grid */}
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <rect
            key={`${r}-${c}`}
            x={gridLeft + c * cellSize}
            y={gridTop + r * cellSize}
            width={cellSize - 2}
            height={cellSize - 2}
            rx="2"
            fill="#374151"
            fillOpacity="0.85"
          />
        ))
      )}

      {/* cell-sized cyan falling block above column blockCol */}
      <rect x={binX(blockCol) + 26} y="20" width="16" height="16" rx="2.5" fill="#3b82f6" />
      <rect x={binX(blockCol) + 29} y="23" width="10" height="3" rx="1" fill="#ffffff" fillOpacity="0.45" />

      {/* bin row on the floor with large letter only, colored border */}
      {bins.map((b, i) => (
        <g key={b.letter}>
          <rect
            x={binX(i)} y="86" width={binW} height="24" rx="4"
            fill="#ffffff" stroke={b.stroke} strokeWidth="2.5"
          />
          <text
            x={binX(i) + binW / 2} y="104"
            fontSize="16" fontFamily="Inter, sans-serif" fontWeight="700"
            fill="#0c1220" textAnchor="middle"
          >
            {b.letter}
          </text>
        </g>
      ))}
    </svg>
  )
}

function ShooterVisual({ accent, className }) {
  return (
    <svg viewBox="0 0 320 120" className={className} role="img" aria-label="Ship with falling letters">
      <rect x="0" y="0" width="320" height="120" fill="#0c1220" />
      {['A', 'B', 'C', 'D'].map((l, i) => (
        <g key={l}>
          <rect x={40 + i * 70} y={20 + (i % 2) * 8} width="32" height="32" rx="4" fill={i === 2 ? accent : '#1e293b'} />
          <text x={56 + i * 70} y={42 + (i % 2) * 8} fontSize="16" fontFamily="Inter, sans-serif" fontWeight="700" fill="#f1f5f9" textAnchor="middle">{l}</text>
        </g>
      ))}
      {/* bullet */}
      <rect x="155" y="70" width="4" height="10" fill={accent} />
      {/* ship */}
      <polygon points="140,100 180,100 160,80" fill="#0ea5e9" />
    </svg>
  )
}

function SnakeVisual({ accent, className }) {
  return (
    <svg viewBox="0 0 320 120" className={className} role="img" aria-label="Snake approaching lettered food">
      <rect x="0" y="0" width="320" height="120" fill="#0c1220" />
      {/* grid hint */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <line key={`v${i}`} x1={40 + i * 36} y1="20" x2={40 + i * 36} y2="100" stroke="#0f172a" strokeWidth="1" />
      ))}
      {/* snake body */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={60 + i * 20} y="56" width="18" height="18" rx="3" fill={accent} opacity={0.4 + i * 0.15} />
      ))}
      {/* foods */}
      {['A', 'B', 'C', 'D'].map((l, i) => (
        <g key={l}>
          <rect x={170 + i * 28} y="52" width="22" height="22" rx="3" fill="#1e293b" />
          <text x={181 + i * 28} y="68" fontSize="12" fontFamily="Inter, sans-serif" fontWeight="700" fill="#f1f5f9" textAnchor="middle">{l}</text>
        </g>
      ))}
    </svg>
  )
}
