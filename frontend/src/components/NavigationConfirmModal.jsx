import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

export function NavigationConfirmModal({ onCancel, onLeave }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-7 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-confirm-title"
      >
        <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
          Hold up
        </div>
        <h2 id="nav-confirm-title" className="mt-1 text-xl sm:text-2xl font-bold text-slate-100">
          Leave this game?
        </h2>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          Your progress will be saved and you can resume later from this device.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <motion.button
            ref={cancelRef}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:ring-brand-400"
          >
            Stay in game
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onLeave}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700"
          >
            Leave
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}
