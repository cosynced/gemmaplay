import { useState } from 'react'
import { motion } from 'framer-motion'

export function ShareLink({ lessonId, className = '' }) {
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = `${origin}/play/${lessonId}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // ignore
    }
  }

  return (
    <div className={`flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ${className}`}>
      <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 font-mono">
        {url}
      </code>
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={copy}
        className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors shrink-0 ${
          copied
            ? 'bg-emerald-500 shadow-lg shadow-emerald-500/25'
            : 'bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/25'
        }`}
      >
        {copied ? 'Copied!' : 'Copy link'}
      </motion.button>
    </div>
  )
}
