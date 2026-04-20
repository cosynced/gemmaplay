import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

function XIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function AlertTriangle(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function DownloadIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function CopyIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function buildCsv(username, pin) {
  return `username,login_pin\n${username},${pin}\n`
}

function downloadCredentialsCsv(username, pin) {
  const blob = new Blob([buildCsv(username, pin)], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gemmaplay-credentials-${username}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Shown once, immediately after register() succeeds. The user must tick
 * "I've saved my credentials" before they can continue — there is no
 * password recovery, losing these credentials loses the account.
 */
export function CredentialsModal({ username, pin, onContinue }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [autoDownloadNoted, setAutoDownloadNoted] = useState(false)
  const didAutoDownload = useRef(false)

  // Auto-download once on mount. Guarded against React StrictMode double-
  // mount and any accidental re-render.
  useEffect(() => {
    if (didAutoDownload.current) return
    didAutoDownload.current = true
    if (username && pin) {
      downloadCredentialsCsv(username, pin)
      setAutoDownloadNoted(true)
    }
  }, [username, pin])

  async function copyCredentials() {
    try {
      await navigator.clipboard.writeText(`username: ${username}, pin: ${pin}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked, silently fail */
    }
  }

  function manualDownload() {
    downloadCredentialsCsv(username, pin)
  }

  // Split PIN into digits for wide spaced display.
  const pinDigits = (pin || '').split('')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="relative w-full max-w-md sm:max-w-lg my-auto rounded-2xl bg-slate-900/95 border border-slate-800 p-5 sm:p-8"
      >
        {saved && (
          <button
            onClick={onContinue}
            aria-label="Close"
            className="absolute top-3 right-3 p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <XIcon className="w-5 h-5" />
          </button>
        )}

        <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
          Account created
        </div>
        <h2 className="mt-1 text-2xl sm:text-3xl font-bold">
          Your account is ready.
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Save these credentials. You will need both to sign back in.
        </p>

        <div className="mt-6 rounded-2xl bg-slate-950/60 border border-slate-800 p-5 sm:p-6 space-y-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              Username
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold text-slate-100 break-words">
              @{username}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              Login PIN
            </div>
            <div
              className="mt-2 flex items-center gap-1 sm:gap-2 font-mono text-3xl sm:text-4xl font-bold text-brand-500"
              aria-label={`Login PIN ${pin}`}
            >
              {pinDigits.map((d, i) => (
                <span
                  key={i}
                  className="w-9 sm:w-12 text-center rounded-lg bg-slate-900/80 border border-slate-800 py-2"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={manualDownload}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm"
          >
            <DownloadIcon className="w-4 h-4" />
            Download CSV
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={copyCredentials}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm text-white transition-colors ${
              copied
                ? 'bg-emerald-500 shadow-lg shadow-emerald-500/25'
                : 'bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/30'
            }`}
          >
            <CopyIcon className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy credentials'}
          </motion.button>
        </div>
        {autoDownloadNoted && (
          <p className="mt-2 text-xs text-slate-500 text-center">
            CSV downloaded. Click the button to download again if needed.
          </p>
        )}

        <div className="mt-6 flex items-start gap-3 rounded-xl bg-amber-500/10 border border-amber-500/40 p-3 sm:p-4 text-amber-200 text-sm">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-300" />
          <div>
            Save these now. If you lose them, you lose access to your lessons
            and dashboard. No password reset available.
          </div>
        </div>

        <label className="mt-6 flex items-start gap-3 cursor-pointer text-sm text-slate-300">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 w-5 h-5 accent-brand-500 shrink-0"
          />
          <span>I've saved my credentials.</span>
        </label>

        <motion.button
          whileHover={saved ? { scale: 1.02 } : undefined}
          whileTap={saved ? { scale: 0.98 } : undefined}
          disabled={!saved}
          onClick={onContinue}
          className={`mt-5 w-full px-6 py-3 rounded-xl font-semibold text-sm transition-colors ${
            saved
              ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/30'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          Continue
        </motion.button>
      </motion.div>
    </motion.div>
  )
}
