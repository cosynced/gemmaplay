// TetrisAnswerScene
//
// Arcade-Tetris look on a light gray canvas: a left playfield with a
// dark-slate rounded-cell grid and chunky rounded blocks, plus a right
// HUD column of stat panels (NEXT, SCORE, CORRECT, LEVEL, PAUSE).
//
// Mechanic is unchanged from the previous prompt: a plain blue block
// falls, four bins along the bottom show ACTUAL ANSWER TEXT, and the
// student steers the block into the bin that matches the question's
// correct answer. Wrong answers stack as colourful semi-transparent
// blocks above the misclicked bin — five of them in the same column
// reach the question strip and end the run.

import { incrementAttempts } from '../utils/attemptCounter.js'
import { QuestionDispatcher } from '../utils/questionDispatcher.js'
import {
  clearGameState,
  loadGameState,
  saveGameState,
} from '../utils/gameStatePersist.js'
import { tetrisAutoPlay } from './AutoPlayAdapter.js'
import { createPauseOverlay } from './PauseOverlay.js'

// ---------- Layout ----------

const GAME_W = 960
const GAME_H = 540

// Horizontal split: left playfield / gap / right HUD column.
const PLAYFIELD_X = 0
const PLAYFIELD_W = 620
const HUD_X = 640
const HUD_W = 300

// Inside the playfield: question strip on top, grid beneath.
const QUESTION_STRIP_H = 60
const GRID_MARGIN = 70               // horizontal margin inside playfield
const GRID_X = GRID_MARGIN           // 70
const GRID_W = PLAYFIELD_W - 2 * GRID_MARGIN // 480
const GRID_Y = QUESTION_STRIP_H      // 60
const GRID_H = GAME_H - QUESTION_STRIP_H     // 480

// Decorative grid cells (40 px → 12 cols × 12 rows).
const CELL = 40
const GRID_COLS = Math.floor(GRID_W / CELL) // 12
const GRID_ROWS = Math.floor(GRID_H / CELL) // 12

// Four answer columns, each spanning 3 decorative cells (3 × 40 = 120).
const COL_COUNT = 4
const COL_W = GRID_W / COL_COUNT    // 120

// Block: 80 × 80 (2 cells). Leaves 20 px padding on each side of the
// answer column so the colourful stacks look chunky but not cramped.
const BLOCK_SIZE = 80

// Bins occupy the bottom 80 px of the grid (1 block-row tall).
const BIN_H = 80
const BIN_TOP = GRID_Y + GRID_H - BIN_H   // 460
const BIN_BOTTOM = GRID_Y + GRID_H        // 540

const BLOCK_SPAWN_Y = GRID_Y + BLOCK_SIZE / 2 + 8 // 108

// ---------- Tuning (unchanged from the previous prompt) ----------

const START_DROP_MS = 800
const MIN_DROP_MS = 400
const DROP_MULT = 0.95             // 5% faster every N questions
const SPEED_BUMP_EVERY_N_Q = 10
const FAST_DROP_MS = 300
const READING_PAUSE_MS = 2000
const SCORE_CORRECT = 10

// ---------- Colours ----------

const COLOR = {
  outerBg: 0xd1d5db,       // light gray canvas
  gridCell: 0x374151,      // empty cell fill
  gridLine: 0x9ca3af,      // 1 px subtle separators
  questionBg: 0xe5e7eb,    // question strip bg (slightly darker gray)
  questionText: '#0f172a',
  fallingBlock: 0x3b82f6,  // vibrant blue falling block
  correctBlock: 0x10b981,  // brief green flash before the block disappears
  hudPanel: 0x1f2937,      // dark slate HUD card
  hudPanelStroke: 0x374151,
  hudText: '#f9fafb',
  hudLabel: '#9ca3af',
  pauseHover: 0x2563eb,
  dimmedBin: 0x475569,
  binStroke: 0xffffff,
  binFill: 0xffffff,
  binText: '#0c1220',
}

// One bin per column, each with a brand-accent border colour.
const BIN_COLORS = [0x0ea5e9, 0xa855f7, 0xfacc15, 0x10b981]

// Wrong-stack colour rotation — red / amber / violet / pink, cycling by
// stack depth. Matches the reference's rainbow tower.
const STACK_COLORS = [0xef4444, 0xf59e0b, 0x8b5cf6, 0xec4899]

// ---------- Helpers ----------

function colCenterX(col) {
  return GRID_X + col * COL_W + COL_W / 2
}

/**
 * Build a chunky rounded block as a Phaser Container so shadow + body +
 * highlight travel together. Returns the container; call `redrawBlock`
 * to change its colour/alpha later.
 */
function makeBlock(scene, x, y, fillColor, alpha = 1) {
  const shadow = scene.add.graphics()
  const body = scene.add.graphics()
  const highlight = scene.add.graphics()
  const container = scene.add.container(x, y, [shadow, body, highlight])
  container.setSize(BLOCK_SIZE, BLOCK_SIZE)
  redrawBlock(container, fillColor, alpha)
  return container
}

function redrawBlock(container, fillColor, alpha = 1) {
  const [shadow, body, highlight] = container.list
  const s = BLOCK_SIZE
  const r = 10
  shadow.clear()
  shadow.fillStyle(0x000000, 0.25 * alpha)
  shadow.fillRoundedRect(-s / 2 + 3, -s / 2 + 5, s, s, r)
  body.clear()
  body.fillStyle(fillColor, alpha)
  body.fillRoundedRect(-s / 2, -s / 2, s, s, r)
  body.lineStyle(2, 0xffffff, 0.35 * alpha)
  body.strokeRoundedRect(-s / 2, -s / 2, s, s, r)
  highlight.clear()
  highlight.fillStyle(0xffffff, 0.35 * alpha)
  highlight.fillRoundedRect(-s / 2 + 8, -s / 2 + 8, s / 2 - 4, s / 4 - 2, 6)
}

// ---------- Scene ----------

export class TetrisAnswerScene extends Phaser.Scene {
  constructor() {
    super('TetrisAnswerScene')
  }

  // ---------- Init ----------

  init(data) {
    this.gameData = data.game
    this.lessonData = data.lesson
    this.sessionId = data.sessionId || 'harness'
    this.onSessionEnd = data.onSessionEnd || (() => {})
    this.autoPlay = !!data.autoPlay

    this.score = 0
    this.correctCount = 0
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false
    this._isPaused = false
    this._pauseStartTs = 0
    this._accumulatedPauseMs = 0
    this._readingPauseUntil = 0
    this._readingBadge = null
    this._didInitialCountdown = false
    this._fastDropOn = false

    this.hintPendingForNextQuestion = false
    this.currentHintUsed = false

    this.qd = new QuestionDispatcher(this.lessonData)

    this._gameId = (this.gameData && this.gameData.game_id) || null
    this.attemptNumber = this.autoPlay ? 0 : incrementAttempts(
      this._gameId || 'tetris_answer_harness'
    )

    // HUD text refs — wired in _buildHud, updated by state change.
    this.hud = { scoreVal: null, correctVal: null, levelVal: null, pausePanel: null }
  }

  _snapshot() {
    const stacks = [[], [], [], []]
    for (let col = 0; col < COL_COUNT; col++) {
      for (let i = 0; i < this.stacks[col].length; i++) {
        stacks[col].push(i % STACK_COLORS.length)
      }
    }
    return {
      score: this.score,
      correctCount: this.correctCount,
      dropMs: this.dropMs,
      stacks,
      elapsedMs: Date.now() - this.startTs - (this._accumulatedPauseMs || 0),
      attemptNumber: this.attemptNumber,
      dispatcher: this.qd ? this.qd.snapshot() : null,
    }
  }

  _restore(snap) {
    try {
      if (!snap || !this.qd.restore(snap.dispatcher)) return false
      this.score = snap.score ?? 0
      this.correctCount = snap.correctCount ?? 0
      this.dropMs = snap.dropMs ?? START_DROP_MS
      this.startTs = Date.now() - (snap.elapsedMs | 0)
      this._accumulatedPauseMs = 0
      if (snap.attemptNumber) this.attemptNumber = snap.attemptNumber
      // Rebuild each column's wrong-stack visually.
      if (Array.isArray(snap.stacks)) {
        for (let col = 0; col < COL_COUNT && col < snap.stacks.length; col++) {
          const colorIdxList = snap.stacks[col] || []
          for (let i = 0; i < colorIdxList.length; i++) {
            const y = BIN_TOP - (i + 1) * BLOCK_SIZE + BLOCK_SIZE / 2
            const color = STACK_COLORS[colorIdxList[i] % STACK_COLORS.length]
            const container = makeBlock(this, colCenterX(col), y, color, 0.8)
              .setDepth(35)
            this.stacks[col].push(container)
          }
        }
      }
      this._updateHudScore()
      this._updateHudCorrect()
      this._updateHudLevel()
      return true
    } catch (e) {
      console.error('Tetris restore failed', e)
      return false
    }
  }

  _saveSnapshot() {
    if (this.autoPlay || this.ended || !this._gameId) return
    try { saveGameState(this._gameId, this._snapshot()) } catch { /* ignore */ }
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.outerBg)

    this._drawPlayfield()
    this._drawDecorativeGrid()
    this._drawQuestionStrip()
    this._buildHud()

    // Mechanic state
    this.stacks = [[], [], [], []]
    this.activeBlock = null
    this.bins = null
    this.dropMs = START_DROP_MS

    this._setupInput()

    // Restore any saved in-progress run (rebuilds wrong-stack visuals).
    let restored = false
    if (!this.autoPlay && this._gameId) {
      const snap = loadGameState(this._gameId)
      if (snap) {
        restored = this._restore(snap)
        if (!restored) clearGameState(this._gameId)
      }
    }

    this._startLevel()
    this._installPauseControls()

    if (restored) {
      this.time.delayedCall(0, () => { if (!this.ended) this._pause() })
    }

    if (this.autoPlay) this._autoPlayCtl = tetrisAutoPlay(this)
  }

  // Subtle outer frame around the playfield — looks like an arcade bezel.
  _drawPlayfield() {
    const frame = this.add.graphics().setDepth(1)
    frame.fillStyle(COLOR.outerBg, 1)
    frame.fillRect(0, 0, PLAYFIELD_W, GAME_H)
    // Slight inset panel behind the grid cells to anchor them visually.
    frame.fillStyle(0xbac0c9, 1)
    frame.fillRoundedRect(GRID_X - 10, GRID_Y - 6, GRID_W + 20, GRID_H + 12, 12)
    frame.lineStyle(2, 0x6b7280, 0.8)
    frame.strokeRoundedRect(GRID_X - 10, GRID_Y - 6, GRID_W + 20, GRID_H + 12, 12)
  }

  _drawDecorativeGrid() {
    const g = this.add.graphics().setDepth(2)
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x = GRID_X + col * CELL + 2
        const y = GRID_Y + row * CELL + 2
        g.fillStyle(COLOR.gridCell, 1)
        g.fillRoundedRect(x, y, CELL - 4, CELL - 4, 4)
      }
    }
    // Thin vertical dividers between answer columns so the 4-bin structure
    // reads at a glance even before the bins are drawn.
    const sep = this.add.graphics().setDepth(3)
    sep.fillStyle(COLOR.gridLine, 0.5)
    for (let i = 1; i < COL_COUNT; i++) {
      const x = GRID_X + i * COL_W
      sep.fillRect(x - 1, GRID_Y, 2, GRID_H)
    }
  }

  _drawQuestionStrip() {
    const bar = this.add.rectangle(PLAYFIELD_W / 2, QUESTION_STRIP_H / 2, PLAYFIELD_W, QUESTION_STRIP_H, COLOR.questionBg, 1)
      .setStrokeStyle(1, 0x9ca3af)
      .setDepth(5)
    this.questionText = this.add.text(PLAYFIELD_W / 2, QUESTION_STRIP_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '16px',
      color: COLOR.questionText,
      fontStyle: 'bold',
      wordWrap: { width: PLAYFIELD_W - 40 },
      align: 'center',
      maxLines: 2,
    }).setOrigin(0.5).setDepth(6)
  }

  // ---------- Right-side HUD column ----------

  _buildHud() {
    // Column divider (light, subtle). Not strictly necessary but gives the
    // HUD a clear "panel" container feel.
    this.add.graphics()
      .fillStyle(0xbac0c9, 1)
      .fillRect(PLAYFIELD_W, 0, 20, GAME_H)

    const panelX = HUD_X + 20
    const panelW = HUD_W - 40
    const topPad = 20
    const gap = 10
    const statH = 80
    // 4 stat panels stacked, PAUSE fills the rest.
    const statY = (i) => topPad + i * (statH + gap)
    const pauseY = topPad + 4 * (statH + gap) // y top
    const pauseH = GAME_H - pauseY - topPad   // stretches to bottom

    this._drawHudPanel('NEXT', panelX, statY(0), panelW, statH)
    this._drawNextPreview(panelX + panelW / 2, statY(0) + 10, panelW, statH)
    const scorePanel = this._drawHudPanel('SCORE', panelX, statY(1), panelW, statH)
    this.hud.scoreVal = this._drawHudValue(scorePanel, '0')
    const correctPanel = this._drawHudPanel('CORRECT', panelX, statY(2), panelW, statH)
    this.hud.correctVal = this._drawHudValue(correctPanel, '0')
    const questionPanel = this._drawHudPanel('QUESTION', panelX, statY(3), panelW, statH)
    this.hud.questionVal = this._drawHudValue(questionPanel, '1')

    this._drawPauseButton(panelX, pauseY, panelW, pauseH)
  }

  _drawHudPanel(label, x, y, w, h) {
    const g = this.add.graphics().setDepth(10)
    g.fillStyle(COLOR.hudPanel, 1)
    g.fillRoundedRect(x, y, w, h, 12)
    g.lineStyle(1, COLOR.hudPanelStroke, 1)
    g.strokeRoundedRect(x, y, w, h, 12)
    this.add.text(x + w / 2, y + 14, label, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color: COLOR.hudLabel,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(11)
    return { x, y, w, h }
  }

  _drawHudValue(panel, initial) {
    const t = this.add.text(panel.x + panel.w / 2, panel.y + panel.h - 14, initial, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '30px',
      color: COLOR.hudText,
      fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(11)
    return t
  }

  _drawNextPreview(cx, panelTopY, panelW, panelH) {
    // The preview shows a static plain blue block since every falling
    // block looks the same. Still useful as a "what's coming" anchor.
    const previewSize = 40
    const block = makeBlock(this, cx, panelTopY + panelH / 2 + 10, COLOR.fallingBlock, 1)
    block.setDepth(11)
    block.setScale(previewSize / BLOCK_SIZE)
    this._nextPreview = block
  }

  _drawPauseButton(x, y, w, h) {
    // High depth so hit-testing always resolves to this button even if
    // later changes layer gameplay elements in the HUD column.
    const depth = 500
    const g = this.add.graphics().setDepth(depth)
    const redraw = (hover) => {
      g.clear()
      g.fillStyle(hover ? COLOR.pauseHover : COLOR.hudPanel, 1)
      g.fillRoundedRect(x, y, w, h, 14)
      g.lineStyle(2, hover ? 0x60a5fa : COLOR.hudPanelStroke, 1)
      g.strokeRoundedRect(x, y, w, h, 14)
    }
    redraw(false)
    const label = this.add.text(x + w / 2, y + h / 2 - 10, 'PAUSE', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '22px',
      color: COLOR.hudText,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth + 1)
    // Two chunky pause bars below the label
    const bars = this.add.graphics().setDepth(depth + 1)
    bars.fillStyle(0xffffff, 0.9)
    const cx = x + w / 2
    const barY = y + h / 2 + 14
    bars.fillRoundedRect(cx - 16, barY, 10, 28, 2)
    bars.fillRoundedRect(cx + 6, barY, 10, 28, 2)

    g.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    g.on('pointerover', () => redraw(true))
    g.on('pointerout', () => redraw(false))
    g.on('pointerdown', () => this._togglePause())
    this.hud.pausePanel = { g, label, bars }
  }

  // ---------- Input ----------

  _setupInput() {
    this._softDropTimer = null
    if (this.autoPlay) return

    this.input.keyboard.on('keydown', (ev) => {
      if (this.ended || this._isPaused || this._isReading()) return
      const k = ev.key
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') this._moveBlockLeft()
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this._moveBlockRight()
      else if (k === 'ArrowDown' || k === 's' || k === 'S') this._fastDropOn = true
    })
    this.input.keyboard.on('keyup', (ev) => {
      const k = ev.key
      if (k === 'ArrowDown' || k === 's' || k === 'S') this._fastDropOn = false
    })

    // Pointer swipes + tap-to-snap
    this._pointerStart = null
    this.input.on('pointerdown', (p) => {
      this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
    })
    this.input.on('pointerup', (p) => {
      if (this.ended || this._isPaused || this._isReading() || !this._pointerStart) {
        this._pointerStart = null
        return
      }
      const dx = p.x - this._pointerStart.x
      const dy = p.y - this._pointerStart.y
      const dt = Date.now() - this._pointerStart.t
      const SWIPE = 30
      const TAP_MOVE = 10
      const TAP_TIME = 250

      // Ignore pointer events that originated in the HUD column.
      if (this._pointerStart.x >= HUD_X) { this._pointerStart = null; return }

      if (Math.abs(dx) < TAP_MOVE && Math.abs(dy) < TAP_MOVE && dt < TAP_TIME) {
        if (p.x >= GRID_X && p.x <= GRID_X + GRID_W) {
          const col = Phaser.Math.Clamp(Math.floor((p.x - GRID_X) / COL_W), 0, COL_COUNT - 1)
          this._snapBlockToCol(col)
        }
      } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE) {
        if (dx > 0) this._moveBlockRight()
        else this._moveBlockLeft()
      } else if (Math.abs(dy) > SWIPE && dy > 0) {
        this._fastDropOn = true
      }
      this._pointerStart = null
    })
  }

  _moveBlockLeft() { this._moveBlock(-1) }
  _moveBlockRight() { this._moveBlock(1) }

  _moveBlock(dx) {
    if (!this.activeBlock) return
    this._snapBlockToCol(this.activeBlock.col + dx)
  }

  _snapBlockToCol(col) {
    if (!this.activeBlock) return
    const clamped = Phaser.Math.Clamp(col, 0, COL_COUNT - 1)
    if (clamped === this.activeBlock.col) return
    this.activeBlock.col = clamped
    this.tweens.add({
      targets: this.activeBlock.container,
      x: colCenterX(clamped),
      duration: 120,
      ease: 'Sine.easeOut',
    })
  }

  // ---------- Level / question lifecycle ----------

  _startLevel() {
    this._updateHudLevel()
    this.dropMs = START_DROP_MS
    this._advanceQuestion({ refreshBins: true })
  }

  _advanceQuestion({ refreshBins }) {
    let q = this.qd.current()
    if (!q) {
      // Dispatcher auto-reshuffles; this is only a belt-and-braces loop.
      // Game only ends when a column's wrong-stack reaches the top.
      this.qd.shuffleRemaining()
      q = this.qd.current()
      if (!q) return
    }
    this.currentQuestion = q
    this.questionText.setText(q.q)
    this._updateHudLevel()

    const order = [0, 1, 2, 3]
    Phaser.Utils.Array.Shuffle(order)
    const shuffledOptions = order.map((i) => q.options[i] ?? '')
    const correctCol = order.indexOf(q.answer_index)

    if (refreshBins || !this.bins) {
      this._disposeBins(false)
      this._buildBins(shuffledOptions, correctCol)
    } else {
      for (let i = 0; i < COL_COUNT; i++) {
        this.bins.labels[i].setText(shuffledOptions[i])
      }
      this.bins.correctCol = correctCol
      this.bins.colToOptionIdx = order.slice()
    }
    this.bins.colToOptionIdx = order.slice()

    if (this.hintPendingForNextQuestion) {
      this._dimTwoWrongBins()
      this.hintPendingForNextQuestion = false
      this.currentHintUsed = true
    } else {
      this.currentHintUsed = false
    }

    this._spawnBlock()
    this._beginReadingPause(READING_PAUSE_MS)
  }

  // ---------- Bins ----------

  _buildBins(options, correctCol) {
    const sprites = []
    const labels = []
    const borders = []
    for (let i = 0; i < COL_COUNT; i++) {
      const x = colCenterX(i)
      const y = BIN_TOP + BIN_H / 2
      const w = COL_W - 8
      const h = BIN_H - 8
      const bg = this.add.graphics().setDepth(20)
      bg.fillStyle(0xffffff, 1)
      bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10)
      const border = this.add.graphics().setDepth(21)
      border.lineStyle(4, BIN_COLORS[i], 1)
      border.strokeRoundedRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 8)
      const label = this.add.text(x, y, options[i] || '', {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '16px',
        color: COLOR.binText,
        fontStyle: 'bold',
        wordWrap: { width: w - 18 },
        align: 'center',
        maxLines: 3,
      }).setOrigin(0.5).setDepth(22)
      sprites.push(bg)
      borders.push(border)
      labels.push(label)
    }
    this.bins = {
      sprites, borders, labels, correctCol, baseColors: [...BIN_COLORS],
      colToOptionIdx: [0, 1, 2, 3],
    }
  }

  _disposeBins(withFade, onComplete) {
    if (!this.bins) { if (onComplete) onComplete(); return }
    const toKill = [
      ...this.bins.sprites,
      ...this.bins.borders,
      ...this.bins.labels,
    ]
    this.bins = null
    if (withFade) {
      this.tweens.add({
        targets: toKill, alpha: 0, duration: 280, ease: 'Sine.easeIn',
        onComplete: () => {
          for (const el of toKill) el.destroy()
          if (onComplete) onComplete()
        },
      })
    } else {
      for (const el of toKill) el.destroy()
      if (onComplete) onComplete()
    }
  }

  _clearStacks() {
    for (const col of this.stacks) {
      for (const c of col) c.destroy()
      col.length = 0
    }
  }

  // ---------- Falling block ----------

  _spawnBlock() {
    if (this.ended || !this.bins) return
    const col = this.activeBlock?.col ?? 1
    const container = makeBlock(this, colCenterX(col), BLOCK_SPAWN_Y, COLOR.fallingBlock, 1)
      .setDepth(40)
    this.activeBlock = { col, y: BLOCK_SPAWN_Y, container }
  }

  update(_, delta) {
    if (this.ended) return
    if (this._isPaused) return
    if (this._isReading()) return
    if (!this.activeBlock) return

    const dt = delta / 1000
    const effMs = this._fastDropOn
      ? Math.min(this.dropMs, FAST_DROP_MS)
      : this.dropMs
    const speed = (BLOCK_SIZE * 1000) / effMs
    this.activeBlock.y += speed * dt

    const stackHeight = this.stacks[this.activeBlock.col].length
    const landingY = BIN_TOP - stackHeight * BLOCK_SIZE - BLOCK_SIZE / 2

    if (this.activeBlock.y >= landingY) {
      this.activeBlock.y = landingY
      this.activeBlock.container.y = landingY
      this._landBlock()
      return
    }
    this.activeBlock.container.y = this.activeBlock.y
  }

  _landBlock() {
    if (!this.activeBlock || !this.bins) return
    const block = this.activeBlock
    this.activeBlock = null
    this._fastDropOn = false
    const col = block.col
    const correct = col === this.bins.correctCol

    const chosenOptionIdx = this.bins.colToOptionIdx[col]
    this.qd.submitAnswer(chosenOptionIdx)

    if (correct) {
      this.score += SCORE_CORRECT
      this.correctCount += 1
      this._updateHudScore()
      this._updateHudCorrect()
      this._flash(0x10b981)
      this._floatingScore(colCenterX(col), BIN_TOP - 20)

      // Briefly flash the block green before fading it away.
      redrawBlock(block.container, COLOR.correctBlock, 1)
      this.tweens.add({
        targets: block.container,
        alpha: 0, scale: 0.92, duration: 280, ease: 'Sine.easeIn',
        onComplete: () => { try { block.container.destroy() } catch { /* torn */ } },
      })

      this._maybeSpeedBump()

      this.qd.advance()
      this._saveSnapshot()
      this._disposeBins(true, () => {
        if (!this.ended) this._advanceQuestion({ refreshBins: true })
      })
    } else {
      this._flash(0xef4444)
      this.cameras.main.shake(150, 0.005)

      const colorIdx = this.stacks[col].length % STACK_COLORS.length
      redrawBlock(block.container, STACK_COLORS[colorIdx], 0.8)
      this.stacks[col].push(block.container)

      this._maybeSpeedBump()

      if (this._stackReachedTop()) {
        this._banner('Tower reached the top.', '#ef4444')
        return this._endSession()
      }

      this.qd.advance()
      this._saveSnapshot()
      this._advanceQuestion({ refreshBins: false })
    }
  }

  _maybeSpeedBump() {
    const answered = this.qd.getProgress().answered
    if (answered > 0 && answered % SPEED_BUMP_EVERY_N_Q === 0) {
      const next = Math.max(MIN_DROP_MS, Math.floor(this.dropMs * DROP_MULT))
      if (next < this.dropMs) {
        this.dropMs = next
        this._banner('Speeding up!', '#10b981')
      }
    }
  }

  _stackReachedTop() {
    for (const col of this.stacks) {
      if (BIN_TOP - col.length * BLOCK_SIZE <= GRID_Y) return true
    }
    return false
  }

  // ---------- HUD updates ----------

  _updateHudScore() {
    if (this.hud.scoreVal) this.hud.scoreVal.setText(String(this.score))
  }

  _updateHudCorrect() {
    if (this.hud.correctVal) this.hud.correctVal.setText(String(this.correctCount))
  }

  _updateHudLevel() {
    if (this.hud.questionVal) {
      const answered = this.qd ? this.qd.getProgress().answered : 0
      // Show the question the player is ABOUT to answer (1-based).
      this.hud.questionVal.setText(String(answered + 1))
    }
  }

  // ---------- Adaptation: show_hint ----------

  _dimTwoWrongBins() {
    if (!this.bins) return
    const wrongs = []
    for (let i = 0; i < COL_COUNT; i++) {
      if (i !== this.bins.correctCol) wrongs.push(i)
    }
    Phaser.Utils.Array.Shuffle(wrongs)
    const targets = wrongs.slice(0, 2)
    const restore = []
    for (const i of targets) {
      restore.push({ i, color: this.bins.baseColors[i] })
      // Redraw border in dimmed tone
      const x = colCenterX(i)
      const y = BIN_TOP + BIN_H / 2
      const w = COL_W - 8
      const h = BIN_H - 8
      this.bins.borders[i].clear()
      this.bins.borders[i].lineStyle(4, COLOR.dimmedBin, 1)
      this.bins.borders[i].strokeRoundedRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 8)
      this.bins.labels[i].setAlpha(0.5)
    }
    this.time.delayedCall(3000, () => {
      if (!this.bins) return
      for (const { i, color } of restore) {
        if (this.bins.borders[i]) {
          const x = colCenterX(i)
          const y = BIN_TOP + BIN_H / 2
          const w = COL_W - 8
          const h = BIN_H - 8
          this.bins.borders[i].clear()
          this.bins.borders[i].lineStyle(4, color, 1)
          this.bins.borders[i].strokeRoundedRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 8)
        }
        if (this.bins.labels[i]) this.bins.labels[i].setAlpha(1)
      }
    })
  }

  // ---------- Visual helpers ----------

  _flash(color) {
    if (this.autoPlay) return
    this.cameras.main.flash(180, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(PLAYFIELD_W / 2, QUESTION_STRIP_H + 8, text, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '18px',
      color,
      backgroundColor: '#1f2937',
      padding: { x: 14, y: 6 },
    }).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: QUESTION_STRIP_H - 4, duration, delay: 200,
      onComplete: () => t.destroy(),
    })
  }

  _floatingScore(x, y) {
    const t = this.add.text(x, y, '+10', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '24px',
      color: '#10b981',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(60)
    this.tweens.add({
      targets: t, alpha: 0, y: y - 40, duration: 700, ease: 'Sine.easeOut',
      onComplete: () => t.destroy(),
    })
  }

  // ---------- Session end ----------

  _endSession() {
    if (this.ended) return
    if (this.autoPlay) return this._resetAndRestart()
    this._showGameOver()
  }

  _showGameOver() {
    this.ended = true
    if (this._gameId) { try { clearGameState(this._gameId) } catch { /* ignore */ } }
    if (this._softDropTimer) { this._softDropTimer.remove(); this._softDropTimer = null }
    const cx = GAME_W / 2
    const cy = GAME_H / 2
    this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x0c1220, 0.88).setDepth(500)
    this.add.text(cx, cy - 140, 'Run over', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '40px',
      color: '#f1f5f9', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(501)
    const prog = this.qd.getProgress()
    const elapsed = this._effectiveTimeSeconds()
    const pct = prog.answered > 0 ? Math.round((prog.correct / prog.answered) * 100) : 0
    this.add.text(cx, cy - 30, [
      `You reached question ${prog.answered}`,
      `Score: ${this.score}`,
      `Correct: ${prog.correct}/${prog.answered} (${pct}%)`,
      `Time: ${elapsed}s`,
      `Attempt ${this.attemptNumber}`,
    ].join('\n'), {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
      color: '#e2e8f0', align: 'center',
    }).setOrigin(0.5).setDepth(501)

    this._makeButton(cx - 90, cy + 90, 'Play Again', 0x3b82f6,
      () => this._resetAndRestart())
    this._makeButton(cx + 90, cy + 90, 'Back to Picker', 0x334155,
      () => this._goBackToPicker())

    this.input.keyboard.once('keydown-ENTER', () => this._resetAndRestart())
  }

  _makeButton(x, y, label, fillColor, onClick) {
    const w = 160, h = 44, r = 10
    const x0 = x - w / 2, y0 = y - h / 2
    const g = this.add.graphics().setDepth(501)
    const draw = (alpha) => {
      g.clear()
      g.fillStyle(fillColor, alpha)
      g.fillRoundedRect(x0, y0, w, h, r)
    }
    draw(1)
    this.add.text(x, y, label, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px',
      color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(502)
    g.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(x0, y0, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    g.on('pointerover', () => draw(0.75))
    g.on('pointerout', () => draw(1))
    g.on('pointerdown', onClick)
    return g
  }

  _resetAndRestart() {
    this.scene.restart({
      game: this.gameData,
      lesson: this.lessonData,
      sessionId: this.sessionId,
      onSessionEnd: this.onSessionEnd,
      autoPlay: this.autoPlay,
    })
  }

  _goBackToPicker() {
    const prog = this.qd.getProgress()
    this.onSessionEnd({
      score: this.score,
      hearts: 0,
      time_seconds: this._effectiveTimeSeconds(),
      hintsUsed: this.hintsUsed,
      questions_answered: prog.answered,
      questions_correct: prog.correct,
      max_streak: prog.max_streak,
    })
  }

  // ---------- Pause ----------

  _installPauseControls() {
    if (this.autoPlay) return
    this._pauseOverlay = createPauseOverlay(this)
    // Pause button is the bottom HUD panel built in _buildHud; no extra pill.
    this.input.keyboard.on('keydown-P', () => this._togglePause())
    this.input.keyboard.on('keydown-ESC', () => this._togglePause())

    const onVis = () => {
      if (document.hidden && !this._isPaused && !this.ended) {
        this._pause()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVis)
    })
  }

  _togglePause() {
    if (this.ended) return
    if (this._isPaused) this._resume()
    else this._pause()
  }

  _pause() {
    if (this.ended || this._isPaused) return
    this._isPaused = true
    this._pauseStartTs = Date.now()
    this.time.paused = true
    this.tweens.pauseAll()
    this.physics?.world?.pause?.()
    this._fastDropOn = false
    this._pauseOverlay?.show({
      onResume: () => this._resume(),
      onQuit: () => this._quitToPicker(),
    })
  }

  _resume() {
    if (!this._isPaused) return
    if (this._pauseStartTs) {
      this._accumulatedPauseMs += Date.now() - this._pauseStartTs
      this._pauseStartTs = 0
    }
    this._isPaused = false
    this.time.paused = false
    this.tweens.resumeAll()
    this.physics?.world?.resume?.()
    if (this.input.keyboard) this.input.keyboard.enabled = true
    this._pauseOverlay?.hide()
  }

  _quitToPicker() {
    if (this.ended) return
    if (this._isPaused && this._pauseStartTs) {
      this._accumulatedPauseMs += Date.now() - this._pauseStartTs
      this._pauseStartTs = 0
    }
    this.ended = true
    this.time.paused = false
    this._pauseOverlay?.hide()
    if (this._softDropTimer) { this._softDropTimer.remove(); this._softDropTimer = null }
    const prog = this.qd.getProgress()
    this.onSessionEnd({
      score: this.score,
      hearts: 0,
      time_seconds: this._effectiveTimeSeconds(),
      hintsUsed: this.hintsUsed,
      questions_answered: prog.answered,
      questions_correct: prog.correct,
      max_streak: prog.max_streak,
    })
  }

  _effectiveTimeSeconds() {
    const now = Date.now()
    let paused = this._accumulatedPauseMs || 0
    if (this._isPaused && this._pauseStartTs) {
      paused += now - this._pauseStartTs
    }
    return Math.floor((now - this.startTs - paused) / 1000)
  }

  // ---------- Reading pause ----------

  _isReading() {
    return this.time.now < (this._readingPauseUntil || 0)
  }

  _beginReadingPause(ms = READING_PAUSE_MS) {
    // Only the first question gets a pause. Subsequent advances flow
    // straight through so gameplay never freezes.
    if (this.autoPlay || this._didInitialCountdown) return
    this._didInitialCountdown = true
    this._readingPauseUntil = this.time.now + ms
    this._hideReadyBadge()
    const badge = this.add.text(PLAYFIELD_W - 20, QUESTION_STRIP_H + 8, 'Ready…', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
      color: '#1d4ed8', fontStyle: 'bold',
      backgroundColor: '#ffffff', padding: { x: 10, y: 4 },
    }).setOrigin(1, 0).setDepth(250)
    this._readingBadge = badge
    this.tweens.add({
      targets: badge, alpha: 0, duration: Math.max(ms - 300, 200), delay: 300,
      onComplete: () => {
        if (this._readingBadge === badge) {
          badge.destroy()
          this._readingBadge = null
        }
      },
    })
  }

  _hideReadyBadge() {
    if (this._readingBadge) {
      try { this._readingBadge.destroy() } catch { /* ignore */ }
      this._readingBadge = null
    }
  }
}
