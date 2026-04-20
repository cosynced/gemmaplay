import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LandingBackground } from './LandingBackground.jsx'

// ---------- Block rain ----------
// Rendered inside a single section with `relative overflow-hidden`; blocks
// spawn at the top edge of the section and fall through it, then clip.
const BLOCK_COLORS = ['#0ea5e9', '#a855f7', '#facc15', '#10b981']

function BlockRain({
  count = 34,
  colors = BLOCK_COLORS,
  peakMin = 0.55,
  peakMax = 0.9,
}) {
  const blocks = useMemo(() => (
    Array.from({ length: count }, (_, i) => {
      const size = 14 + Math.random() * 16      // 14–30 px
      const color = colors[i % colors.length]
      return {
        key: i,
        left: Math.random() * 100,                // %
        size,
        color,
        duration: 4 + Math.random() * 4,          // 4–8 s
        delay: -Math.random() * 8,                // staggered negative delays
        spin: (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 320),
        peak: peakMin + Math.random() * Math.max(0, peakMax - peakMin),
      }
    })
  ), [count, colors, peakMin, peakMax])

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {blocks.map((b) => (
        <span
          key={b.key}
          className="absolute rounded-[4px] shadow-md"
          style={{
            top: '-32px',
            left: `${b.left}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            backgroundColor: b.color,
            animation: `blockFall ${b.duration}s linear infinite`,
            animationDelay: `${b.delay}s`,
            ['--spin']: `${b.spin}deg`,
            ['--peak']: b.peak,
            ['--fall-h']: '720px',
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  )
}

// ---------- Small helpers ----------

function Section({ id, className = '', children }) {
  return (
    <section id={id} className={`w-full px-4 sm:px-6 md:px-10 py-14 sm:py-20 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  )
}

// Inline SVG icons (no new icon dep added).
function UploadIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
function SparklesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M5.6 5.6l2.8 2.8" />
      <path d="M15.6 15.6l2.8 2.8" />
      <path d="M5.6 18.4l2.8-2.8" />
      <path d="M15.6 8.4l2.8-2.8" />
    </svg>
  )
}
function ChartIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" rx="0.5" />
      <rect x="12" y="8" width="3" height="10" rx="0.5" />
      <rect x="17" y="4" width="3" height="14" rx="0.5" />
    </svg>
  )
}
function ArrowDownIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}
function PlayIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function GithubIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.8 10.9.6.1.8-.2.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.6-1.3-1.6-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4C17.6 3.4 18.6 3.7 18.6 3.7c.6 1.6.2 2.8.1 3.1.8.9 1.2 1.9 1.2 3.2 0 4.4-2.7 5.4-5.3 5.7.4.3.8 1 .8 2v3c0 .3.2.6.8.6 4.5-1.5 7.8-5.8 7.8-10.9 0-6.3-5.2-11.5-11.5-11.5z" />
    </svg>
  )
}

// ---------- Data ----------

const GAMES = [
  {
    name: 'Lane Runner',
    accent: '#0ea5e9',
    description: 'Endless runner with answer gates. Steer into the correct lane.',
    best: 'Any lesson. High-energy, broad appeal.',
  },
  {
    name: 'Answer Stacker',
    accent: '#a855f7',
    description: 'Tetris-style. Drop labeled blocks into the correct bin.',
    best: 'Categorical content, vocabulary, definitions.',
  },
  {
    name: 'Answer Blaster',
    accent: '#facc15',
    description: 'Space Invaders-style. Shoot the falling correct answer.',
    best: 'Fast recall, quick-fire quizzes.',
  },
  {
    name: 'Snake Knowledge',
    accent: '#10b981',
    description: 'Classic Snake. Eat the correct letter, grow; wrong letter shrinks.',
    best: 'Recall under pressure. Vocab, formulas, definitions.',
  },
]

const STEPS = [
  { icon: UploadIcon, title: 'Upload', body: 'Drop in any lesson content: PDF, notes, markdown.' },
  { icon: SparklesIcon, title: 'Generate', body: 'Gemma 4 extracts concepts and builds an adaptive game.' },
  { icon: ChartIcon, title: 'Measure', body: 'Teachers get a per-student report of what was mastered.' },
]

const AUDIENCES = [
  {
    title: 'Teachers',
    body: 'Keep your curriculum. Drop it in. Every lesson becomes engaging without extra prep.',
  },
  {
    title: 'Students',
    body: "Learn through play. Games adapt in real time so no one's stuck, or bored.",
  },
  {
    title: 'Classrooms',
    body: 'Works offline with on-device Gemma. No per-seat licenses, no tracking.',
  },
]

// ---------- Page ----------

export function LandingPage({
  onStart,
  teacher = null,
  onSignInClick,
  onDashboardClick,
  onSignOut,
}) {
  const howItWorksRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = () => setMenuOpen(false)
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [menuOpen])

  function scrollToHowItWorks() {
    howItWorksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* ---------- Top nav (same 3 buttons as the footer) ---------- */}
      <div className="absolute top-0 inset-x-0 z-30 px-4 sm:px-6 pt-4 sm:pt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        <a
          href="https://github.com/cosynced/gemmaplay"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition-colors"
        >
          <GithubIcon className="w-4 h-4" />
          GitHub
        </a>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.location.reload() }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-red-500/25 transition-colors"
        >
          <PlayIcon className="w-4 h-4" />
          Demo Video
        </a>

        {teacher ? (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-200 hover:bg-slate-800 text-xs sm:text-sm font-semibold transition-colors"
            >
              @{teacher}
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-40 rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden z-50"
                >
                  <button
                    onClick={() => { setMenuOpen(false); onDashboardClick?.() }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onSignOut?.() }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 border-t border-slate-800"
                  >
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button
            onClick={() => onSignInClick?.()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-200 hover:bg-slate-800 text-xs sm:text-sm font-semibold transition-colors"
          >
            Sign in
          </button>
        )}
      </div>

      {/* ---------- Section 1: HERO ---------- */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden px-4 sm:px-6 pt-32 sm:pt-24 md:pt-16">
        {/* Live gameplay backdrop: 4 autoPlay Phaser instances in a 2×2 grid */}
        <LandingBackground />
        {/* Dark overlay between backdrop and hero text for contrast */}
        <div
          aria-hidden
          className="absolute inset-0 z-[1] pointer-events-none bg-slate-950/55"
        />
        {/* Subtle tint on top, still below content */}
        <div
          aria-hidden
          className="absolute inset-0 z-[1] pointer-events-none bg-gradient-to-br from-sky-950/30 via-transparent to-violet-950/30"
        />

        <div className="relative z-10 text-center max-w-3xl mx-auto w-full backdrop-blur-sm bg-slate-950/20 rounded-3xl px-5 py-8 sm:px-10 sm:py-12">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-4xl sm:text-6xl md:text-7xl lg:text-[80px] font-extrabold tracking-tight leading-none"
          >
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-sky-300 to-violet-400">
              GemmaPlay
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
            className="mt-4 sm:mt-6 text-lg sm:text-2xl text-slate-200 font-medium"
          >
            Any lesson, any classroom, playable in 60 seconds.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
            className="mt-3 sm:mt-4 text-sm sm:text-lg text-slate-400 max-w-2xl mx-auto"
          >
            Upload any teaching material. Gemma&nbsp;4 turns it into a playable adaptive
            game. Learn the fun way.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6, ease: 'easeOut' }}
            className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4"
          >
            <motion.button
              onClick={onStart}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base sm:text-lg shadow-lg shadow-brand-500/30"
            >
              Try it now
            </motion.button>
            <button
              onClick={scrollToHowItWorks}
              className="text-slate-300 hover:text-white font-medium inline-flex items-center justify-center gap-2 py-2 text-sm sm:text-base"
            >
              See how it works <ArrowDownIcon className="w-4 h-4" />
            </button>
          </motion.div>

          <motion.div
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            className="mt-10 sm:mt-16 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700/70 bg-slate-900/40 backdrop-blur-sm text-xs text-slate-300"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            Built on Gemma 4
          </motion.div>
        </div>
      </section>

      {/* ---------- Section 2: THE FOUR GAMES (with block rain) ---------- */}
      <section className="relative overflow-hidden w-full px-4 sm:px-6 md:px-10 py-14 sm:py-20 bg-slate-950">
        <BlockRain />
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-3xl sm:text-4xl font-bold text-center"
          >
            Four ways to play. <span className="text-slate-400 font-medium">Pick the one your class loves.</span>
          </motion.h2>

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {GAMES.map((g, i) => (
              <motion.div
                key={g.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
                whileHover={{ scale: 1.03, y: -4, boxShadow: '0 20px 40px -12px rgba(14,165,233,0.25)' }}
                className="rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 hover:border-slate-700"
              >
                <div className="h-2" style={{ backgroundColor: g.accent }} />
                <div className="p-6">
                  <h3 className="text-xl font-semibold">{g.name}</h3>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">{g.description}</p>
                  <p className="mt-4 text-xs uppercase tracking-wider text-slate-500">Best for</p>
                  <p className="text-sm text-slate-300">{g.best}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Section 3: HOW IT WORKS (ghost-white rain) ---------- */}
      <section
        ref={howItWorksRef}
        className="relative overflow-hidden w-full px-4 sm:px-6 md:px-10 py-14 sm:py-20 bg-slate-900/40"
      >
        <BlockRain colors={['#ffffff']} peakMin={0.04} peakMax={0.1} />
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-3xl sm:text-4xl font-bold text-center"
          >
            How GemmaPlay works
          </motion.h2>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step, i) => {
              const Icon = step.icon
              return (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.6, delay: i * 0.12, ease: 'easeOut' }}
                  className="text-center px-4"
                >
                  <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/30 text-brand-500 flex items-center justify-center">
                    <Icon className="w-7 h-7" />
                  </div>
                  <div className="mt-5 text-xs uppercase tracking-widest text-slate-500">
                    Step {i + 1}
                  </div>
                  <h3 className="mt-1 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-3 text-sm text-slate-400 leading-relaxed">{step.body}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ---------- Section 4: WHO IT'S FOR (colorful rain again) ---------- */}
      <section className="relative overflow-hidden w-full px-4 sm:px-6 md:px-10 py-14 sm:py-20 bg-slate-950">
        <BlockRain />
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-3xl sm:text-4xl font-bold text-center"
          >
            Built for classrooms that need AI the most
          </motion.h2>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {AUDIENCES.map((a, i) => (
              <motion.div
                key={a.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
                className="p-6 rounded-2xl bg-slate-900 border border-slate-800"
              >
                <div className="text-sm uppercase tracking-widest text-brand-500 font-semibold">
                  {a.title}
                </div>
                <p className="mt-3 text-slate-300 leading-relaxed">{a.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Section 5: CTA + FOOTER (ghost-white rain) ---------- */}
      <section className="relative overflow-hidden w-full px-6 md:px-10 pt-28 pb-12 bg-gradient-to-b from-slate-950 to-slate-900">
        <BlockRain colors={['#ffffff']} peakMin={0.04} peakMax={0.1} />
        <div className="relative z-10 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold">
            Turn today's lesson into today's game.
          </h2>
          <p className="mt-4 text-sm sm:text-base text-slate-400">
            Upload a lesson, pick a game, watch a class light up.
          </p>
          <motion.button
            onClick={onStart}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="mt-6 sm:mt-8 w-full sm:w-auto px-8 sm:px-10 py-4 sm:py-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base sm:text-lg shadow-lg shadow-brand-500/30"
          >
            Start playing. It's free
          </motion.button>
        </motion.div>

        <footer className="mt-12 sm:mt-20 pt-6 sm:pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
          <a
            href="https://github.com/cosynced/gemmaplay"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-3 px-6 py-3 sm:px-8 sm:py-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm sm:text-lg shadow-lg shadow-emerald-500/25 transition-colors"
          >
            <GithubIcon className="w-5 h-5" />
            GitHub
          </a>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.location.reload() }}
            className="inline-flex items-center justify-center gap-3 px-6 py-3 sm:px-8 sm:py-4 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm sm:text-lg shadow-lg shadow-red-500/25 transition-colors"
          >
            <PlayIcon className="w-5 h-5" />
            Demo Video
          </a>
        </footer>
        </div>
      </section>
    </div>
  )
}
