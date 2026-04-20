import { motion } from 'framer-motion'

export function TooLargeWarningModal({ inspection, onContinue, onReupload }) {
  const pages = inspection?.pages_to_process || inspection?.estimated_pages || 0
  const chars = inspection?.char_count ?? 0

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
          Heads up
        </div>
        <h2 className="mt-1 text-2xl sm:text-3xl font-bold">Your material is long</h2>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          We'll use the first <span className="text-slate-200 font-semibold">{pages || 1}</span>{' '}
          {pages === 1 ? 'page' : 'pages'} (≈{' '}
          <span className="text-slate-200 font-semibold">{chars.toLocaleString()}</span>{' '}
          characters) and ignore the rest. Most lessons work best under 10 pages.
          You can re-upload a shorter section for better results.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onReupload}
            className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm"
          >
            Re-upload
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onContinue}
            className="flex-1 px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30"
          >
            Continue with what fits
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}
