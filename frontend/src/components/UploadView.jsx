import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, InsufficientContentError } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import { TooLargeWarningModal } from './TooLargeWarningModal.jsx'
import { InsufficientContentModal } from './InsufficientContentModal.jsx'
import { ErrorBanner } from './ErrorBanner.jsx'

const ACCEPT = '.pdf,.txt,.md,.docx,.pptx,.png,.jpg,.jpeg'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MIN_PASTE_CHARS = 50

// Rotated during the loading state. These don't map to real backend phases —
// they're UX cues so long vision extractions (5-30s) don't feel like a hang.
const LOADING_STEPS = [
  'Reading your content…',
  'Extracting the key concepts…',
  'Building your game…',
]
const AI_FILL_LOADING_STEPS = [
  'Filling in with Gemma…',
  'Reading your content…',
  'Extracting the key concepts…',
  'Building your game…',
]

function stripExtension(name) {
  return (name || '').replace(/\.[^./\\]+$/, '').replace(/[_-]+/g, ' ').trim()
}

export function UploadView({ onUploaded }) {
  const [mode, setMode] = useState('file') // 'file' | 'paste'
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const [pasteText, setPasteText] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')

  const [busy, setBusy] = useState(false)
  const [aiFillBusy, setAiFillBusy] = useState(false)
  const [error, setError] = useState(null)
  const [loadingStep, setLoadingStep] = useState(0)

  // Modal state
  const [tooLarge, setTooLarge] = useState(null)   // { inspection, proceed, reupload }
  const [insufficient, setInsufficient] = useState(null) // Error instance

  // Rotate loading copy during any busy state. AI-fill uses a longer cycle.
  useEffect(() => {
    if (!busy) return
    setLoadingStep(0)
    const steps = aiFillBusy ? AI_FILL_LOADING_STEPS : LOADING_STEPS
    const id = setInterval(() => {
      setLoadingStep((s) => (s + 1) % steps.length)
    }, 3000)
    return () => clearInterval(id)
  }, [busy, aiFillBusy])

  const activeSteps = aiFillBusy ? AI_FILL_LOADING_STEPS : LOADING_STEPS

  function pickFile(f) {
    if (!f) return
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(new Error(`“${f.name}” is larger than 10 MB. Try a smaller file or paste the text instead.`))
      return
    }
    setError(null)
    setFile(f)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    pickFile(f)
  }

  // ---------- Inspect-then-submit flow ----------

  async function handleGenerate() {
    if (busy) return
    setError(null)
    if (mode === 'file') {
      if (!file) return
      await runInspectAndSubmit(
        () => api.inspectLessonFile(file),
        () => doUploadFile(),
      )
    } else {
      const trimmed = pasteText.trim()
      if (trimmed.length < MIN_PASTE_CHARS) {
        setError(new Error(`Please paste at least ${MIN_PASTE_CHARS} characters of lesson content.`))
        return
      }
      await runInspectAndSubmit(
        () => api.inspectLessonText(trimmed),
        () => doPasteSubmit(),
      )
    }
  }

  async function runInspectAndSubmit(inspectFn, submitFn) {
    let inspection = null
    try {
      inspection = await inspectFn()
    } catch (_) {
      // Inspection is an optimization — if it fails, just proceed with
      // the real request.
    }
    if (inspection && inspection.will_truncate) {
      setTooLarge({
        inspection,
        proceed: () => {
          setTooLarge(null)
          submitFn()
        },
        reupload: () => {
          setTooLarge(null)
          if (mode === 'file') setFile(null)
          else setPasteText('')
        },
      })
      return
    }
    await submitFn()
  }

  async function doUploadFile() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.uploadLesson(file)
      onUploaded(result)
    } catch (e) {
      if (e instanceof InsufficientContentError) {
        setInsufficient(e)
      } else {
        logError(e, { where: 'uploadLesson' })
        setError(e)
      }
    } finally {
      setBusy(false)
    }
  }

  async function doPasteSubmit() {
    const trimmed = pasteText.trim()
    if (trimmed.length < MIN_PASTE_CHARS) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.pasteLesson(trimmed, pasteTitle.trim() || null)
      onUploaded(result)
    } catch (e) {
      if (e instanceof InsufficientContentError) {
        setInsufficient(e)
      } else {
        logError(e, { where: 'pasteLesson' })
        setError(e)
      }
    } finally {
      setBusy(false)
    }
  }

  // ---------- AI fill ----------

  async function handleAiFill() {
    let topic = ''
    let existing = ''
    if (mode === 'paste') {
      existing = pasteText.trim()
      topic = pasteTitle.trim() || existing.slice(0, 200)
    } else if (file) {
      // For files we rarely have the raw text on the client; use the
      // filename as a hint and let Gemma riff on the topic. existing_text
      // must be non-empty, so fall back to the filename too.
      topic = stripExtension(file.name) || 'educational topic'
      existing = topic
    }
    if (!topic || !existing) {
      setError(new Error('Can\'t derive a topic. Switch to "Paste text" and try again.'))
      return
    }
    setAiFillBusy(true)
    setBusy(true)
    setError(null)
    try {
      const result = await api.aiFillLesson(topic, existing, pasteTitle.trim() || null)
      setInsufficient(null)
      onUploaded(result)
    } catch (e) {
      if (e instanceof InsufficientContentError) {
        // Gemma still couldn't build enough. Keep the modal with updated counts.
        setInsufficient(e)
      } else {
        logError(e, { where: 'aiFillLesson' })
        setError(e)
      }
    } finally {
      setAiFillBusy(false)
      setBusy(false)
    }
  }

  function dismissInsufficient() {
    setInsufficient(null)
  }

  // ---------- Render ----------

  const canSubmit = mode === 'file'
    ? !!file
    : pasteText.trim().length >= MIN_PASTE_CHARS

  return (
    <section className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-2xl mx-auto"
      >
        <div className="text-center mb-10">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
            Step 1 · Upload
          </div>
          <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-bold">
            Drop in any lesson.
          </h2>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className="rounded-2xl bg-slate-900/60 border border-slate-800 p-6 md:p-8"
        >
          <ModeToggle mode={mode} onChange={(next) => {
            if (busy) return
            setMode(next)
            setError(null)
          }} />

          <AnimatePresence mode="wait">
            {mode === 'file' ? (
              <motion.div
                key="file"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <motion.label
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  whileHover={{ scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                  className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-brand-500 bg-brand-500/5'
                      : file
                        ? 'border-emerald-500/60 bg-emerald-500/5'
                        : 'border-slate-700 hover:border-brand-500/60 hover:bg-brand-500/5'
                  }`}
                >
                  <input
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0] || null)}
                  />
                  <UploadCloudIcon className={`w-10 h-10 mb-3 ${file ? 'text-emerald-400' : 'text-brand-500'}`} />
                  {file ? (
                    <>
                      <div className="text-base font-semibold text-slate-100">{file.name}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {(file.size / 1024).toFixed(1)} KB · click to replace
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-base font-semibold text-slate-100">
                        Drop a file here, or click to choose
                      </div>
                      <div className="mt-1 text-xs text-slate-500 uppercase tracking-wider">
                        PDF · DOCX · PPTX · PNG · JPG · TXT · MD
                      </div>
                    </>
                  )}
                </motion.label>
                <p className="mt-3 text-xs text-slate-500 text-center">
                  PDFs, Word, PowerPoint, images of notes,
                  or plain text. Max 10 MB.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="paste"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <label className="block text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">
                  Title <span className="text-slate-600 normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Photosynthesis — chapter 4"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-500"
                />
                <label className="block text-xs uppercase tracking-wider text-slate-500 font-medium mt-4 mb-2">
                  Lesson text
                </label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste your lesson content here — notes, outlines, slide text, anything."
                  className="w-full min-h-[200px] px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-500 resize-y"
                />
                <div className="mt-2 flex justify-between text-xs text-slate-500">
                  <span>Minimum {MIN_PASTE_CHARS} characters.</span>
                  <span>{pasteText.trim().length} chars</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <div className="mt-5">
              <ErrorBanner error={error} onDismiss={() => setError(null)} />
            </div>
          )}

          <motion.button
            disabled={!canSubmit || busy}
            onClick={handleGenerate}
            whileHover={!busy && canSubmit ? { scale: 1.03 } : undefined}
            whileTap={!busy && canSubmit ? { scale: 0.97 } : undefined}
            className={`mt-6 w-full px-8 py-4 rounded-xl font-semibold text-lg transition-colors ${
              !canSubmit || busy
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/30'
            }`}
          >
            {busy ? (
              <AnimatePresence mode="wait">
                <motion.span
                  key={loadingStep}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="inline-block"
                >
                  {activeSteps[loadingStep] || activeSteps[0]}
                </motion.span>
              </AnimatePresence>
            ) : (
              'Generate game'
            )}
          </motion.button>
        </motion.div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Your file stays private. Only the extracted concepts are stored.
        </p>
      </motion.div>

      <AnimatePresence>
        {tooLarge && (
          <TooLargeWarningModal
            inspection={tooLarge.inspection}
            onContinue={tooLarge.proceed}
            onReupload={tooLarge.reupload}
          />
        )}
        {insufficient && (
          <InsufficientContentModal
            error={insufficient}
            aiFillBusy={aiFillBusy}
            onUploadMore={dismissInsufficient}
            onAiFill={handleAiFill}
            onCancel={dismissInsufficient}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function ModeToggle({ mode, onChange }) {
  return (
    <div className="mb-6 flex justify-center">
      <div className="inline-flex p-1 rounded-xl bg-slate-950/60 border border-slate-800">
        <ModePill active={mode === 'file'} onClick={() => onChange('file')}>Upload a file</ModePill>
        <ModePill active={mode === 'paste'} onClick={() => onChange('paste')}>Paste text</ModePill>
      </div>
    </div>
  )
}

function ModePill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
        active
          ? 'bg-brand-500 text-white shadow shadow-brand-500/30'
          : 'text-slate-400 hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function UploadCloudIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
