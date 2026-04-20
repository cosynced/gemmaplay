import { useId, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Tiny markdown renderer. We only need the subset Gemma is prompted to
// produce: ## headings, blank-line-separated paragraphs, inline *em* /
// **strong**. Pulling in react-markdown would dominate the bundle just to
// render a dozen lines.
function renderInline(text) {
  // Split on bold/italic markers while keeping them in the output.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (!p) return null
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} className="text-slate-100 font-semibold">{p.slice(2, -2)}</strong>
    }
    if (p.startsWith('*') && p.endsWith('*')) {
      return <em key={i} className="text-slate-200 italic">{p.slice(1, -1)}</em>
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={i} className="px-1 py-0.5 rounded bg-slate-800 text-sky-300 text-[0.9em]">{p.slice(1, -1)}</code>
    }
    return <span key={i}>{p}</span>
  })
}

function parseNotes(notes) {
  if (!notes) return []
  const blocks = []
  const lines = notes.replace(/\r\n/g, '\n').split('\n')
  let buffer = []
  const flushParagraph = () => {
    const joined = buffer.join(' ').trim()
    buffer = []
    if (joined) blocks.push({ type: 'p', text: joined })
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^#{1,6}\s/.test(line)) {
      flushParagraph()
      const match = line.match(/^(#{1,6})\s+(.*)$/)
      blocks.push({ type: 'h', level: match[1].length, text: match[2].trim() })
    } else if (line.trim() === '') {
      flushParagraph()
    } else {
      buffer.push(line.trim())
    }
  }
  flushParagraph()
  return blocks
}

export function GameTranscript({ notes, title, defaultExpanded = false, className = '' }) {
  const blocks = useMemo(() => parseNotes(notes), [notes])
  const [expanded, setExpanded] = useState(defaultExpanded)
  const panelId = useId()

  if (!blocks.length) return null

  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden flex flex-col ${className}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={`group w-full flex items-center gap-3 text-left px-5 py-3 bg-slate-950/60 hover:bg-slate-950/80 transition-colors min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          expanded ? 'border-b border-slate-800' : ''
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-brand-500 font-semibold">
            Your notes
          </div>
          {title && (
            <div className="mt-0.5 text-sm font-semibold text-slate-100 truncate" title={title}>
              {title}
            </div>
          )}
        </div>
        <motion.span
          aria-hidden
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex-shrink-0 text-slate-400 group-hover:text-slate-200"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="transcript-body"
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 overflow-y-auto text-sm leading-relaxed text-slate-300 space-y-3 max-h-[min(60vh,520px)]">
              {blocks.map((b, i) => {
                if (b.type === 'h') {
                  const sizeClass = b.level <= 2
                    ? 'text-base font-semibold text-slate-100'
                    : 'text-sm font-semibold text-slate-200'
                  return (
                    <h3 key={i} className={`${sizeClass} mt-4 first:mt-0`}>
                      {renderInline(b.text)}
                    </h3>
                  )
                }
                return <p key={i}>{renderInline(b.text)}</p>
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  )
}
