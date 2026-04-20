import { motion } from 'framer-motion'

export function InsufficientContentModal({
  error,
  onUploadMore,
  onAiFill,
  onCancel,
  aiFillBusy,
}) {
  const partial = error?.data?.partial || {}
  const concepts = partial.concepts_found ?? 0

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-full max-w-md my-auto rounded-2xl bg-slate-900/95 border border-slate-800 p-5 sm:p-8"
      >
        <div className="text-xs uppercase tracking-widest text-amber-400 font-semibold">
          Not enough material
        </div>
        <h2 className="mt-1 text-2xl sm:text-3xl font-bold">
          We need a bit more to work with
        </h2>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          {error?.data?.message || error?.message || 'Your content was too thin.'}{' '}
          Gemma found only{' '}
          <span className="text-slate-200 font-semibold">{concepts}</span>{' '}
          {concepts === 1 ? 'concept' : 'concepts'}. We need at least&nbsp;3 to
          build a good game.
        </p>
        <p className="mt-3 text-sm text-slate-400">What would you like to do?</p>

        <div className="mt-6 flex flex-col gap-3">
          <motion.button
            whileHover={!aiFillBusy ? { scale: 1.02 } : undefined}
            whileTap={!aiFillBusy ? { scale: 0.98 } : undefined}
            onClick={onUploadMore}
            disabled={aiFillBusy}
            className="px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30 disabled:opacity-60"
          >
            Upload more
          </motion.button>
          <motion.button
            whileHover={!aiFillBusy ? { scale: 1.02 } : undefined}
            whileTap={!aiFillBusy ? { scale: 0.98 } : undefined}
            onClick={onAiFill}
            disabled={aiFillBusy}
            className="px-6 py-3 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm shadow-lg shadow-violet-500/25 disabled:opacity-60"
          >
            {aiFillBusy ? 'Asking Gemma to fill the gaps…' : 'Let Gemma fill the gaps'}
          </motion.button>
          {onCancel && (
            <motion.button
              whileHover={!aiFillBusy ? { scale: 1.02 } : undefined}
              whileTap={!aiFillBusy ? { scale: 0.98 } : undefined}
              onClick={onCancel}
              disabled={aiFillBusy}
              className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm disabled:opacity-60"
            >
              Cancel
            </motion.button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
