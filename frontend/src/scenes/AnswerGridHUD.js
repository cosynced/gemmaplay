// AnswerGridHUD
//
// Shared "answer reference" block: a question banner with a 2x2 grid of
// color-coded A/B/C/D option panels beneath. Rendered outside the gameplay
// zone. Callers pass options in LETTER order (options[0] is shown next to
// the "A" chip, options[1] next to "B", etc.) so the caller owns the
// shuffle and the in-game targets can display just a letter.

export const OPTION_COLORS = {
  0: 0x0ea5e9, // A cyan
  1: 0xa855f7, // B purple
  2: 0xf59e0b, // C amber
  3: 0x10b981, // D emerald
}

export const OPTION_HEX = {
  0: '#0ea5e9',
  1: '#a855f7',
  2: '#f59e0b',
  3: '#10b981',
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D']

const DEFAULTS = {
  questionHeight: 50,
  cellHeight: 48,
  gap: 8,
  padding: 10,
  questionFontSize: 15,
  optionFontSize: 13,
  questionLines: 2,
  optionLines: 2,
  chipSize: 32,
  chipLetterSize: 18,
}

export function answerGridHeight(opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  return o.questionHeight + 10 + 2 * o.cellHeight + o.gap
}

/**
 * Render question banner + 2x2 answer grid at (x, y) with the given width.
 * Returns { elements, height } — destroy `elements` before re-rendering
 * and use `height` to lay things out beneath the grid.
 *
 * options: 4-item array, option text in letter order (A=options[0]..).
 * correctIndex: preserved for future use; does not affect rendering.
 */
export function renderAnswerGrid(scene, {
  x,
  y,
  width,
  question,
  options,
  correctIndex: _correctIndex,
  depth = 200,
  questionHeight,
  cellHeight,
  gap,
  padding,
  questionFontSize,
  optionFontSize,
  questionLines,
  optionLines,
  chipSize,
  chipLetterSize,
}) {
  const o = {
    questionHeight: questionHeight ?? DEFAULTS.questionHeight,
    cellHeight: cellHeight ?? DEFAULTS.cellHeight,
    gap: gap ?? DEFAULTS.gap,
    padding: padding ?? DEFAULTS.padding,
    questionFontSize: questionFontSize ?? DEFAULTS.questionFontSize,
    optionFontSize: optionFontSize ?? DEFAULTS.optionFontSize,
    questionLines: questionLines ?? DEFAULTS.questionLines,
    optionLines: optionLines ?? DEFAULTS.optionLines,
    chipSize: chipSize ?? DEFAULTS.chipSize,
    chipLetterSize: chipLetterSize ?? DEFAULTS.chipLetterSize,
  }

  const elements = []
  const innerW = width - 2 * o.padding
  const cellW = Math.floor((innerW - o.gap) / 2)

  const qBg = scene.add.graphics().setDepth(depth)
  qBg.fillStyle(0x0f172a, 0.92)
  qBg.fillRoundedRect(x + o.padding, y, innerW, o.questionHeight, 10)
  qBg.lineStyle(2, 0x334155, 1)
  qBg.strokeRoundedRect(x + o.padding, y, innerW, o.questionHeight, 10)
  const qText = scene.add.text(
    x + width / 2,
    y + o.questionHeight / 2,
    question || '',
    {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: `${o.questionFontSize}px`,
      color: '#f8fafc',
      fontStyle: 'bold',
      wordWrap: { width: innerW - 20 },
      align: 'center',
      maxLines: o.questionLines,
    },
  ).setOrigin(0.5).setDepth(depth + 1)
  elements.push(qBg, qText)

  const gridTop = y + o.questionHeight + 10
  for (let i = 0; i < 4; i++) {
    const col = i % 2
    const row = Math.floor(i / 2)
    const cx = x + o.padding + col * (cellW + o.gap)
    const cy = gridTop + row * (o.cellHeight + o.gap)
    const color = OPTION_COLORS[i]

    const bg = scene.add.graphics().setDepth(depth)
    bg.fillStyle(0x0f172a, 0.94)
    bg.fillRoundedRect(cx, cy, cellW, o.cellHeight, 10)
    bg.lineStyle(2.5, color, 1)
    bg.strokeRoundedRect(cx, cy, cellW, o.cellHeight, 10)

    const chip = scene.add.graphics().setDepth(depth + 1)
    const chipY = cy + (o.cellHeight - o.chipSize) / 2
    chip.fillStyle(color, 1)
    chip.fillRoundedRect(cx + 8, chipY, o.chipSize, o.chipSize, 8)
    const letter = scene.add.text(
      cx + 8 + o.chipSize / 2,
      cy + o.cellHeight / 2,
      OPTION_LETTERS[i],
      {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: `${o.chipLetterSize}px`,
        color: '#0c1220',
        fontStyle: 'bold',
      },
    ).setOrigin(0.5).setDepth(depth + 2)

    const optStr = (options && options[i] != null) ? String(options[i]) : ''
    const optText = scene.add.text(
      cx + 8 + o.chipSize + 10,
      cy + o.cellHeight / 2,
      optStr,
      {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: `${o.optionFontSize}px`,
        color: '#f1f5f9',
        wordWrap: { width: cellW - o.chipSize - 28 },
        align: 'left',
        maxLines: o.optionLines,
      },
    ).setOrigin(0, 0.5).setDepth(depth + 2)

    elements.push(bg, chip, letter, optText)
  }

  return { elements, height: answerGridHeight(o) }
}

/**
 * Helper for callers that need to tear down the previous render.
 */
export function destroyAnswerGrid(handles) {
  if (!handles || !Array.isArray(handles.elements)) return
  for (const el of handles.elements) {
    try { el.destroy() } catch { /* already gone */ }
  }
  handles.elements = []
}
