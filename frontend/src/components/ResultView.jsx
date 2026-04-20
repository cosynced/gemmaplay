import { motion } from 'framer-motion'
import { ShareLink } from './ShareLink.jsx'

// Must mirror backend bucket logic in report_prompts.tone_bucket_for_score.
function scoreBucket(score) {
  if (score == null) return 'partial'
  if (score < 30) return 'struggling'
  if (score < 60) return 'partial'
  if (score < 80) return 'solid'
  return 'strong'
}

const BUCKET_HEADERS = {
  struggling: 'Tough round.',
  partial: 'Mixed results.',
  solid: 'Good run.',
  strong: 'Excellent work.',
}

export function ResultView({
  report,
  runStats,
  lessonId,
  onDashboard,
  onReplay,
  onBackToPicker,
  onPlayAgain,
}) {
  const bucket = scoreBucket(report?.score)
  const header = BUCKET_HEADERS[bucket] || BUCKET_HEADERS.partial
  const answered = runStats?.questions_answered ?? 0
  const correct = runStats?.questions_correct ?? 0
  const pct = answered > 0 ? Math.round((correct / answered) * 100) : 0
  const runScore = runStats?.score ?? report?.score ?? 0

  return (
    <div className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-xl mx-auto rounded-2xl bg-slate-900/60 border border-slate-800 p-6 sm:p-8"
      >
        <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
          Session complete
        </div>
        <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-bold">{header}</h2>
        {runStats && answered > 0 && (
          <p className="mt-2 text-slate-300 text-base sm:text-lg font-semibold">
            You reached question {answered}
          </p>
        )}
        <p className="mt-1 text-slate-400 text-sm sm:text-base">
          Your report will show up on the dashboard.
        </p>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <Stat label="Score" value={runScore} />
          <Stat label="Correct" value={`${correct}/${answered} (${pct}%)`} />
          <Stat label="Time" value={`${report?.time_seconds ?? 0}s`} />
          <Stat label="Hints" value={report?.hints_used ?? 0} />
        </div>

        {report?.narrative && (
          <div className="mt-6 p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-sm italic text-slate-300">
            “{report.narrative}”
          </div>
        )}

        {lessonId && (
          <div className="mt-6">
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
              Share this lesson
            </div>
            <ShareLink lessonId={lessonId} />
          </div>
        )}

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          {onPlayAgain && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onPlayAgain}
              className="w-full sm:flex-1 px-4 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30"
            >
              Play again
            </motion.button>
          )}
          {onBackToPicker && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onBackToPicker}
              className="w-full sm:flex-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm border border-slate-700"
            >
              Back to picker
            </motion.button>
          )}
          {onReplay && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onReplay}
              className="w-full sm:flex-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm"
            >
              Upload another lesson
            </motion.button>
          )}
          {onDashboard && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onDashboard}
              className="w-full sm:flex-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm"
            >
              Dashboard
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}
