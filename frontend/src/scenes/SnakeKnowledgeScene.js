// SnakeKnowledgeScene
//
// Classic Snake where the 4 food tiles are the A/B/C/D answer options.
// Eat the correct one to grow and advance; eating a wrong one shrinks
// the snake by 1. Game over on wall / self-bite / shrink-to-zero. Starts
// at length 3 so early mistakes don't immediately end the run. Sprites
// slide between cells instead of teleporting for a smoother feel.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd, autoPlay? }
//     game.game_type = 'snake_knowledge'
//   onSessionEnd({ score, hearts, time_seconds, hintsUsed })

import { incrementAttempts } from '../utils/attemptCounter.js'
import { QuestionDispatcher } from '../utils/questionDispatcher.js'
import {
  clearGameState,
  loadGameState,
  saveGameState,
} from '../utils/gameStatePersist.js'
import {
  OPTION_COLORS,
  destroyAnswerGrid,
  renderAnswerGrid,
} from './AnswerGridHUD.js'
import { snakeAutoPlay } from './AutoPlayAdapter.js'
import { createPauseOverlay } from './PauseOverlay.js'

// ---------- Layout ----------

const GAME_W = 960
const GAME_H = 540
const TILE = 30
const COLS = 32
const ROWS = 11

// Shared AnswerGridHUD at the top, then the scene HUD strip, then the
// play grid.
const GRID_HUD_TOP = 8
const GRID_HUD_OPTS = {
  questionHeight: 36,
  cellHeight: 34,
  gap: 6,
  padding: 12,
  questionFontSize: 13,
  optionFontSize: 12,
  optionLines: 2,
  chipSize: 24,
  chipLetterSize: 13,
}
const GRID_HUD_HEIGHT = 36 + 10 + 2 * 34 + 6 // 120
const HUD_STRIP_TOP = GRID_HUD_TOP + GRID_HUD_HEIGHT + 6 // 134
const HUD_STRIP_H = 40
const GRID_TOP = HUD_STRIP_TOP + HUD_STRIP_H + 6 // 180
const GRID_LEFT = 0
const GRID_BOTTOM = GRID_TOP + ROWS * TILE  // 510

// ---------- Tuning ----------

const START_LENGTH = 3
const START_TICK_MS = 400
const MIN_TICK_MS = 200
const PER_CORRECT_TICK_DELTA = 5
const READING_PAUSE_MS = 2000
const SCORE_CORRECT = 10

// ---------- Colors ----------

const COLOR = {
  bg: 0x0a0f1c,
  hud: 0x0f172a,
  stroke: 0x1e293b,
  gridFill: 0x0a0f1c,
  gridLine: 0xffffff,
  gridLineAlpha: 0.05,
  headFill: 0x22d3ee,       // cyan head
  headEye: 0x0f172a,
  headEyeLight: 0xffffff,
  bodyLight: 0x334155,       // slate body (head end)
  bodyDark: 0x1e293b,        // slate body (tail end)
  dimmedTile: 0x475569,
  A: OPTION_COLORS[0],
  B: OPTION_COLORS[1],
  C: OPTION_COLORS[2],
  D: OPTION_COLORS[3],
  textHex: '#e2e8f0',
  mutedHex: '#94a3b8',
  labelHex: '#9ca3af',
  correctBurst: 0x10b981,
  wrongFlash: 0xef4444,
}

const LETTER_KEYS = ['A', 'B', 'C', 'D']

function cellX(col) { return GRID_LEFT + col * TILE + TILE / 2 }
function cellY(row) { return GRID_TOP + row * TILE + TILE / 2 }

function lerpTint(light, dark, t) {
  const lr = (light >> 16) & 0xff
  const lg = (light >> 8) & 0xff
  const lb = light & 0xff
  const dr = (dark >> 16) & 0xff
  const dg = (dark >> 8) & 0xff
  const db = dark & 0xff
  const r = Math.round(lr + (dr - lr) * t)
  const g = Math.round(lg + (dg - lg) * t)
  const b = Math.round(lb + (db - lb) * t)
  return (r << 16) | (g << 8) | b
}

export class SnakeKnowledgeScene extends Phaser.Scene {
  constructor() {
    super('SnakeKnowledgeScene')
  }

  init(data) {
    this.gameData = data.game
    this.lessonData = data.lesson
    this.sessionId = data.sessionId || 'harness'
    this.onSessionEnd = data.onSessionEnd || (() => {})
    this.autoPlay = !!data.autoPlay
    this.initialTickMs = data.tickMs || START_TICK_MS

    this.score = 0
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false
    this._gameOverReason = null
    this._isPaused = false
    this._pauseStartTs = 0
    this._accumulatedPauseMs = 0
    this._readingPauseUntil = 0
    this._readingBadge = null
    this._didInitialCountdown = false

    this.hintPendingForNextQuestion = false
    this.currentHintUsed = false

    this.qd = new QuestionDispatcher(this.lessonData)

    this._gameId = (this.gameData && this.gameData.game_id) || null
    this.attemptNumber = this.autoPlay ? 0 : incrementAttempts(
      this._gameId || 'snake_knowledge_harness'
    )
  }

  _snapshot() {
    return {
      score: this.score,
      snake: this.snake ? this.snake.map((s) => ({ col: s.col, row: s.row })) : null,
      dir: this.dir,
      tickMs: this.tickMs,
      elapsedMs: Date.now() - this.startTs - (this._accumulatedPauseMs || 0),
      attemptNumber: this.attemptNumber,
      dispatcher: this.qd ? this.qd.snapshot() : null,
    }
  }

  _restore(snap) {
    try {
      if (!snap || !this.qd.restore(snap.dispatcher)) return false
      if (Array.isArray(snap.snake) && snap.snake.length > 0) {
        this.snake = snap.snake.map((s) => ({ col: s.col | 0, row: s.row | 0 }))
      }
      if (snap.dir) { this.dir = snap.dir; this.nextDir = snap.dir }
      if (snap.tickMs) this.tickMs = snap.tickMs
      this.score = snap.score ?? 0
      this.startTs = Date.now() - (snap.elapsedMs | 0)
      this._accumulatedPauseMs = 0
      if (snap.attemptNumber) this.attemptNumber = snap.attemptNumber
      if (this.scoreText) this.scoreText.setText(String(this.score))
      if (this.snake && this.snakeSprites !== undefined) this._renderSnake({ animate: false })
      this._renderLengthHud()
      return true
    } catch (e) {
      console.error('Snake restore failed', e)
      return false
    }
  }

  _saveSnapshot() {
    if (this.autoPlay || this.ended || !this._gameId) return
    try { saveGameState(this._gameId, this._snapshot()) } catch { /* ignore */ }
  }

  // ---------- Preload: generate textures ----------

  preload() {
    const g = this.add.graphics()
    const size = TILE - 2
    const radius = 8

    const makeFoodTile = (color, key, dimmed = false) => {
      g.clear()
      g.fillStyle(color)
      g.fillRoundedRect(0, 0, size, size, radius)
      g.lineStyle(1.5, 0xffffff, dimmed ? 0.2 : 0.65)
      g.strokeRoundedRect(1, 1, size - 2, size - 2, radius)
      g.generateTexture(key, size, size)
    }
    makeFoodTile(COLOR.A, 'snake-food-A')
    makeFoodTile(COLOR.B, 'snake-food-B')
    makeFoodTile(COLOR.C, 'snake-food-C')
    makeFoodTile(COLOR.D, 'snake-food-D')
    makeFoodTile(COLOR.dimmedTile, 'snake-food-dimmed', true)

    // Snake head: rounded cyan tile with two eye dots + pupils.
    g.clear()
    g.fillStyle(COLOR.headFill)
    g.fillRoundedRect(0, 0, size, size, 7)
    g.fillStyle(COLOR.headEyeLight)
    g.fillCircle(size - 9, 9, 3)
    g.fillCircle(9, 9, 3)
    g.fillStyle(COLOR.headEye)
    g.fillCircle(size - 9, 9, 1.5)
    g.fillCircle(9, 9, 1.5)
    g.generateTexture('snake-head', size, size)

    // Snake body: rounded slate tile; per-segment tinting produces the gradient.
    g.clear()
    g.fillStyle(0xffffff)
    g.fillRoundedRect(0, 0, size, size, 5)
    g.generateTexture('snake-body', size, size)

    g.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    // Play field: dark slate backdrop.
    this.add.rectangle(
      GAME_W / 2,
      GRID_TOP + (ROWS * TILE) / 2,
      COLS * TILE,
      ROWS * TILE,
      COLOR.gridFill,
      1,
    ).setStrokeStyle(1, COLOR.stroke)

    // Subtle grid lines.
    for (let c = 1; c < COLS; c++) {
      const x = GRID_LEFT + c * TILE
      this.add.rectangle(x, GRID_TOP + (ROWS * TILE) / 2, 1, ROWS * TILE, COLOR.gridLine, COLOR.gridLineAlpha)
    }
    for (let r = 1; r < ROWS; r++) {
      const y = GRID_TOP + r * TILE
      this.add.rectangle(GRID_LEFT + (COLS * TILE) / 2, y, COLS * TILE, 1, COLOR.gridLine, COLOR.gridLineAlpha)
    }

    this._buildHUD()

    // Snake: START_LENGTH segments in the middle, moving right.
    const startRow = Math.floor(ROWS / 2)
    const startCol = Math.floor(COLS / 2)
    this.snake = []
    for (let i = 0; i < START_LENGTH; i++) {
      this.snake.push({ col: startCol - i, row: startRow })
    }
    this.snakeSprites = []
    this._renderSnake({ animate: false })

    this.dir = 'right'
    this.nextDir = 'right'
    this.tickMs = this.initialTickMs
    this.lastTickAt = 0

    this.foods = []
    this._gridHandles = null

    this._setupInput()

    // Restore a prior run if found.
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
    this._renderLengthHud()

    if (restored) {
      this.time.delayedCall(0, () => { if (!this.ended) this._pause() })
    }

    if (this.autoPlay) this._autoPlayCtl = snakeAutoPlay(this)
  }

  // ---------- Snake rendering ----------

  _renderSnake({ animate } = { animate: true }) {
    const n = this.snake.length
    const tweenDur = Math.max(60, Math.min(150, (this.tickMs || START_TICK_MS) * 0.7))

    // Shrink: fade out removed tail sprites.
    while (this.snakeSprites.length > n) {
      const tail = this.snakeSprites.pop()
      this.tweens.add({
        targets: tail,
        alpha: 0, scaleX: 0.4, scaleY: 0.4,
        duration: 240, ease: 'Sine.easeIn',
        onComplete: () => { try { tail.destroy() } catch { /* ignore */ } },
      })
    }
    // Grow: spawn at the new head cell and pop-in.
    while (this.snakeSprites.length < n) {
      const seg = this.snake[0]
      const sprite = this.add.image(cellX(seg.col), cellY(seg.row), 'snake-head')
        .setDepth(60)
      if (animate) {
        sprite.setScale(0.3)
        this.tweens.add({
          targets: sprite, scaleX: 1, scaleY: 1,
          duration: 220, ease: 'Back.easeOut',
        })
      }
      this.snakeSprites.unshift(sprite)
    }

    // Re-skin each sprite (head vs body) and slide it to its target cell.
    for (let i = 0; i < n; i++) {
      const seg = this.snake[i]
      const sprite = this.snakeSprites[i]
      if (!sprite) continue
      const isHead = i === 0
      sprite.setTexture(isHead ? 'snake-head' : 'snake-body')
      sprite.setDepth(isHead ? 60 : 55 - i)
      if (isHead) {
        sprite.clearTint()
      } else {
        const t = n > 2 ? (i - 1) / (n - 2) : 0
        sprite.setTint(lerpTint(COLOR.bodyLight, COLOR.bodyDark, t))
      }
      const tx = cellX(seg.col)
      const ty = cellY(seg.row)
      if (animate) {
        this.tweens.add({
          targets: sprite, x: tx, y: ty,
          duration: tweenDur, ease: 'Linear',
        })
      } else {
        sprite.setPosition(tx, ty)
      }
    }
  }

  // ---------- HUD ----------

  _buildHUD() {
    const panelPad = 8
    const panelW = 180
    const panelH = HUD_STRIP_H
    const y = HUD_STRIP_TOP

    // Background strip spans the full width.
    this.add.rectangle(
      GAME_W / 2, y + panelH / 2, GAME_W, panelH, COLOR.hud, 0.95,
    ).setStrokeStyle(1, COLOR.stroke).setDepth(200)

    let x = panelPad
    const score = this._drawHudPanel('SCORE', x, y, panelW, panelH)
    this.scoreText = this._drawHudValue(score, '0')
    x += panelW + panelPad

    const lengthPanel = this._drawHudPanel('LENGTH', x, y + 0, panelW * 1.4, panelH)
    this.lengthText = this._drawHudValue(lengthPanel, String(START_LENGTH), {
      x: lengthPanel.x + 34, align: 'left',
    })
    // Small segment icons showing "lives left" (= length - 1).
    this._livesIconGroup = { x: lengthPanel.x + 70, y: lengthPanel.y + panelH / 2, panel: lengthPanel }
    this._livesIconSprites = []
    x += panelW * 1.4 + panelPad

    const qPanel = this._drawHudPanel('QUESTION', x, y, panelW, panelH)
    this.questionCounterText = this._drawHudValue(qPanel, '1')
    x += panelW + panelPad

    // Pause button fills the rest up to the right edge.
    const pauseW = GAME_W - x - panelPad
    this._drawPauseButton(x, y, pauseW, panelH)
  }

  _drawHudPanel(label, x, y, w, h) {
    const g = this.add.graphics().setDepth(201)
    g.fillStyle(0x1f2937, 1)
    g.fillRoundedRect(x, y, w, h, 8)
    g.lineStyle(1, COLOR.stroke, 1)
    g.strokeRoundedRect(x, y, w, h, 8)
    this.add.text(x + 10, y + 6, label, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '10px', color: COLOR.labelHex, fontStyle: 'bold',
    }).setOrigin(0, 0).setDepth(202)
    return { x, y, w, h }
  }

  _drawHudValue(panel, initial, opts = {}) {
    const tx = opts.x ?? (panel.x + panel.w - 10)
    const align = opts.align || 'right'
    const originX = align === 'left' ? 0 : 1
    return this.add.text(tx, panel.y + panel.h - 6, initial, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '18px', color: COLOR.textHex, fontStyle: 'bold',
    }).setOrigin(originX, 1).setDepth(202)
  }

  _drawPauseButton(x, y, w, h) {
    const depth = 500
    const g = this.add.graphics().setDepth(depth)
    const redraw = (hover) => {
      g.clear()
      g.fillStyle(hover ? 0x1d4ed8 : 0x1f2937, 1)
      g.fillRoundedRect(x, y, w, h, 10)
      g.lineStyle(1, hover ? 0x60a5fa : COLOR.stroke, 1)
      g.strokeRoundedRect(x, y, w, h, 10)
    }
    redraw(false)
    const label = this.add.text(x + w / 2 - 12, y + h / 2, 'PAUSE', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px', color: COLOR.textHex, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth + 1)
    const bars = this.add.graphics().setDepth(depth + 1)
    bars.fillStyle(0xffffff, 0.9)
    const cx = x + w / 2 + 24
    const cy = y + h / 2
    bars.fillRoundedRect(cx - 6, cy - 6, 4, 12, 1)
    bars.fillRoundedRect(cx + 2, cy - 6, 4, 12, 1)

    g.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    g.on('pointerover', () => redraw(true))
    g.on('pointerout', () => redraw(false))
    g.on('pointerdown', () => this._togglePause())
    this._hudPauseEls = { g, label, bars }
  }

  _renderLengthHud() {
    if (!this.lengthText || !this._livesIconGroup) return
    const len = this.snake ? this.snake.length : 0
    this.lengthText.setText(String(len))
    // Lives left = length - 1. Render small segment icons next to the
    // LENGTH value, capped at 8 to avoid overflow.
    const livesLeft = Math.max(0, len - 1)
    const shown = Math.min(livesLeft, 8)
    // Reuse / create / destroy icon sprites as needed.
    while (this._livesIconSprites.length > shown) {
      const s = this._livesIconSprites.pop()
      try { s.destroy() } catch { /* ignore */ }
    }
    while (this._livesIconSprites.length < shown) {
      const i = this._livesIconSprites.length
      const ix = this._livesIconGroup.x + i * 12
      const iy = this._livesIconGroup.y
      const s = this.add.image(ix, iy, 'snake-body')
        .setScale(10 / (TILE - 2))
        .setTint(COLOR.bodyLight)
        .setDepth(202)
      this._livesIconSprites.push(s)
    }
  }

  // ---------- Input ----------

  _setupInput() {
    if (this.autoPlay) return
    this.input.keyboard.on('keydown', (ev) => {
      if (this.ended) return
      const k = ev.key
      if (k === 'ArrowUp' || k === 'w' || k === 'W') this._tryTurn('up')
      else if (k === 'ArrowDown' || k === 's' || k === 'S') this._tryTurn('down')
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') this._tryTurn('left')
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this._tryTurn('right')
    })

    // Pointer swipe
    this._pointerStart = null
    this.input.on('pointerdown', (p) => {
      this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
    })
    this.input.on('pointerup', (p) => {
      if (this.ended || !this._pointerStart) { this._pointerStart = null; return }
      const dx = p.x - this._pointerStart.x
      const dy = p.y - this._pointerStart.y
      const SWIPE_THRESHOLD = 30
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        this._tryTurn(dx > 0 ? 'right' : 'left')
      } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
        this._tryTurn(dy > 0 ? 'down' : 'up')
      }
      this._pointerStart = null
    })
  }

  _tryTurn(dir) {
    if (this._isReading() || this._isPaused) return
    const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }
    if (dir === opposite[this.dir]) return
    this.nextDir = dir
  }

  // ---------- Level lifecycle ----------

  _startLevel() {
    this._loadNextQuestion()
  }

  _loadNextQuestion() {
    let q = this.qd.current()
    if (!q) {
      this.qd.shuffleRemaining()
      q = this.qd.current()
      if (!q) return
    }
    this.activeQuestion = q
    if (this.questionCounterText) {
      const answered = this.qd ? this.qd.getProgress().answered : 0
      this.questionCounterText.setText(String(answered + 1))
    }

    destroyAnswerGrid(this._gridHandles)
    this._gridHandles = renderAnswerGrid(this, {
      x: 0,
      y: GRID_HUD_TOP,
      width: GAME_W,
      question: q.q,
      options: q.options || [],
      correctIndex: q.answer_index,
      depth: 195,
      ...GRID_HUD_OPTS,
    })

    this._clearFoods()
    this._spawnFoods()
    this._beginReadingPause(READING_PAUSE_MS)
  }

  _clearFoods() {
    for (const f of this.foods) {
      this.tweens.killTweensOf(f.sprite)
      try { f.sprite.destroy() } catch { /* ignore */ }
      try { f.letterLabel.destroy() } catch { /* ignore */ }
    }
    this.foods = []
  }

  // ---------- Food placement ----------

  _spawnFoods() {
    if (!this.activeQuestion) return
    const q = this.activeQuestion

    let hidden = new Set()
    if (this.hintPendingForNextQuestion) {
      const wrongs = [0, 1, 2, 3].filter((i) => i !== q.answer_index)
      Phaser.Utils.Array.Shuffle(wrongs)
      hidden = new Set(wrongs.slice(0, 2))
      this.hintPendingForNextQuestion = false
      this.currentHintUsed = true
    } else {
      this.currentHintUsed = false
    }

    // Spread the 4 tiles by dividing the grid into quadrants and placing
    // one tile per quadrant. Avoids clustering and keeps tiles non-adjacent.
    const midCol = Math.floor(COLS / 2)
    const midRow = Math.floor(ROWS / 2)
    const quadrants = [
      { c0: 0, c1: midCol, r0: 0, r1: midRow },           // top-left
      { c0: midCol, c1: COLS, r0: 0, r1: midRow },        // top-right
      { c0: 0, c1: midCol, r0: midRow, r1: ROWS },        // bottom-left
      { c0: midCol, c1: COLS, r0: midRow, r1: ROWS },     // bottom-right
    ]
    Phaser.Utils.Array.Shuffle(quadrants)

    const head = this.snake && this.snake.length ? this.snake[0] : { col: 0, row: 0 }
    const nextHeadCells = this._projectedHeadCells(4)
    const avoid = new Set()
    for (const s of this.snake) avoid.add(`${s.col},${s.row}`)
    for (const c of nextHeadCells) avoid.add(`${c.col},${c.row}`)

    const placed = []
    for (let idx = 0; idx < 4; idx++) {
      const quad = quadrants[idx % quadrants.length]
      const cell = this._pickQuadrantCell(quad, avoid, placed)
      if (!cell) continue
      avoid.add(`${cell.col},${cell.row}`)
      // Also avoid placing a second tile adjacent to an earlier placement.
      placed.push(cell)
      const dimmed = hidden.has(idx)
      this._spawnFood(idx, cell.col, cell.row, dimmed)
    }
    // Keep head in scope (suppresses unused-var lints in some setups).
    void head
  }

  _pickQuadrantCell(quad, avoid, placed) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const col = Phaser.Math.Between(quad.c0, Math.max(quad.c0, quad.c1 - 1))
      const row = Phaser.Math.Between(quad.r0, Math.max(quad.r0, quad.r1 - 1))
      const key = `${col},${row}`
      if (avoid.has(key)) continue
      // Keep at least 2 cells between tiles where possible.
      let tooClose = false
      for (const p of placed) {
        if (Math.abs(p.col - col) + Math.abs(p.row - row) < 2) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue
      return { col, row }
    }
    // Fallback: any empty cell (ignore spacing).
    for (let attempt = 0; attempt < 200; attempt++) {
      const col = Phaser.Math.Between(0, COLS - 1)
      const row = Phaser.Math.Between(0, ROWS - 1)
      if (!avoid.has(`${col},${row}`)) return { col, row }
    }
    return null
  }

  _projectedHeadCells(steps) {
    // Cells the snake would occupy in the next `steps` ticks if it
    // kept going in its current direction. Used to keep food from
    // spawning directly in front of the head on session start.
    if (!this.snake || !this.snake.length) return []
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.dir || 'right']
    const head = this.snake[0]
    const out = []
    for (let i = 1; i <= steps; i++) {
      out.push({ col: head.col + d[0] * i, row: head.row + d[1] * i })
    }
    return out
  }

  _spawnFood(letterIdx, col, row, dimmed) {
    const letter = LETTER_KEYS[letterIdx]
    const tex = dimmed ? 'snake-food-dimmed' : `snake-food-${letter}`
    const sprite = this.add.image(cellX(col), cellY(row), tex).setDepth(40)
    const letterLabel = this.add.text(cellX(col), cellY(row), letter, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
      color: dimmed ? '#cbd5e1' : '#0c1220', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(41)
    const food = { sprite, letterLabel, letterIdx, col, row, dimmed, letter }
    if (dimmed) {
      this.tweens.add({
        targets: sprite,
        alpha: { from: 0.95, to: 0.45 },
        duration: 600, yoyo: true, repeat: -1,
      })
    }
    // Pop-in on spawn so new tiles read clearly.
    sprite.setScale(0.6)
    letterLabel.setScale(0.6)
    this.tweens.add({
      targets: [sprite, letterLabel],
      scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.easeOut',
    })
    this.foods.push(food)
  }

  // ---------- Game loop ----------

  update(time) {
    if (this.ended) return
    if (this._isPaused) { this._resumedPendingReset = true; return }
    if (this._isReading()) { this._resumedPendingReset = true; return }
    if (this._resumedPendingReset) {
      this._resumedPendingReset = false
      this.lastTickAt = time
    }
    if (time - this.lastTickAt < this.tickMs) return
    this.lastTickAt = time
    this._tick()
  }

  _tick() {
    this.dir = this.nextDir
    const head = this.snake[0]
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.dir]
    const newHead = { col: head.col + d[0], row: head.row + d[1] }

    if (newHead.col < 0 || newHead.col >= COLS || newHead.row < 0 || newHead.row >= ROWS) {
      this._flash(COLOR.wrongFlash)
      this._gameOverReason = 'Hit the wall'
      return this._endSession()
    }
    for (let i = 0; i < this.snake.length - 1; i++) {
      const seg = this.snake[i]
      if (seg.col === newHead.col && seg.row === newHead.row) {
        this._flash(COLOR.wrongFlash)
        this._gameOverReason = 'Ate yourself'
        return this._endSession()
      }
    }

    this.snake.unshift(newHead)

    const foodIdx = this.foods.findIndex((f) => f.col === newHead.col && f.row === newHead.row)
    if (foodIdx >= 0) {
      this._resolveFood(this.foods[foodIdx], foodIdx)
    } else {
      this.snake.pop()
    }
    this._renderSnake({ animate: true })
    this._renderLengthHud()
  }

  // ---------- Resolution ----------

  _resolveFood(food, foodIdx) {
    const q = this.activeQuestion
    const isCorrect = food.letterIdx === q.answer_index
    this.qd.submitAnswer(food.letterIdx)

    const fx = cellX(food.col)
    const fy = cellY(food.row)

    if (isCorrect) {
      // Snake grew by +1 (unshift with no pop).
      this._destroyFood(food, foodIdx)
      this.score += SCORE_CORRECT
      this.scoreText.setText(String(this.score))
      this.tickMs = Math.max(MIN_TICK_MS, this.tickMs - PER_CORRECT_TICK_DELTA)
      this._flash(COLOR.correctBurst)
      this._greenBurst(fx, fy)
      this._floatScore(fx, fy, `+${SCORE_CORRECT}`, '#10b981')
      this.qd.advance()
      this._saveSnapshot()
      this._loadNextQuestion()
    } else {
      // Wrong: -1 net. Red flash on the tile, short camera shake, tail fades.
      this._wrongTileFlash(fx, fy, food.letter)
      this._destroyFood(food, foodIdx)
      this.cameras.main.shake(150, 0.003)
      // After unshift the snake grew by 1. Pop once to restore length,
      // pop again to shrink by 1.
      this.snake.pop()
      this.snake.pop()
      if (this.snake.length < 1) {
        this._gameOverReason = 'Ran out of length'
        return this._endSession()
      }

      const hasCorrect = this.foods.some((f) => f.letterIdx === q.answer_index)
      if (!hasCorrect) {
        this._banner('No correct answer left — next question', '#f59e0b')
        this.time.delayedCall(1000, () => {
          if (this.ended) return
          this.qd.advance()
          this._loadNextQuestion()
        })
      }
    }
  }

  _destroyFood(food, foodIdx) {
    this.tweens.killTweensOf(food.sprite)
    try { food.sprite.destroy() } catch { /* ignore */ }
    try { food.letterLabel.destroy() } catch { /* ignore */ }
    this.foods.splice(foodIdx, 1)
  }

  // ---------- Visual helpers ----------

  _greenBurst(x, y) {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2)
      const dist = Phaser.Math.Between(24, 44)
      const shard = this.add.rectangle(x, y, 4, 4, COLOR.correctBurst, 1).setDepth(80)
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0, duration: 420, ease: 'Sine.easeOut',
        onComplete: () => { try { shard.destroy() } catch { /* ignore */ } },
      })
    }
  }

  _floatScore(x, y, text, color) {
    const t = this.add.text(x, y - 10, text, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '18px', color, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(85)
    this.tweens.add({
      targets: t, alpha: 0, y: y - 40, duration: 700, ease: 'Sine.easeOut',
      onComplete: () => { try { t.destroy() } catch { /* ignore */ } },
    })
  }

  _wrongTileFlash(x, y, letter) {
    // Brief red pulse at the tile so the student sees the "wrong" cell
    // before it disappears.
    const box = this.add.rectangle(x, y, TILE - 2, TILE - 2, COLOR.wrongFlash, 0.85).setDepth(80)
    const t = this.add.text(x, y, letter, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
      color: '#fee2e2', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(81)
    this.tweens.add({
      targets: [box, t], alpha: 0, scaleX: 1.4, scaleY: 1.4,
      duration: 260, ease: 'Sine.easeOut',
      onComplete: () => {
        try { box.destroy() } catch { /* ignore */ }
        try { t.destroy() } catch { /* ignore */ }
      },
    })
  }

  _flash(color) {
    if (this.autoPlay) return
    this.cameras.main.flash(140, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(GAME_W / 2, GRID_TOP + 6, text, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color,
      backgroundColor: '#0f172a', padding: { x: 12, y: 4 },
    }).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: GRID_TOP - 14, duration, delay: 200,
      onComplete: () => { try { t.destroy() } catch { /* ignore */ } },
    })
  }

  _endSession() {
    if (this.ended) return
    if (this.autoPlay) return this._resetAndRestart()
    this._showGameOver()
  }

  // ---------- Game Over overlay ----------

  _showGameOver() {
    this.ended = true
    if (this._gameId) { try { clearGameState(this._gameId) } catch { /* ignore */ } }
    const cx = GAME_W / 2
    const cy = GAME_H / 2
    this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x0a0f1c, 0.9).setDepth(500)
    this.add.text(cx, cy - 160, 'Run over', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '40px',
      color: '#f1f5f9', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(501)
    if (this._gameOverReason) {
      this.add.text(cx, cy - 110, this._gameOverReason, {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
        color: '#fecaca', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(501)
    }
    const prog = this.qd.getProgress()
    const elapsed = this._effectiveTimeSeconds()
    const pct = prog.answered > 0 ? Math.round((prog.correct / prog.answered) * 100) : 0
    this.add.text(cx, cy - 30, [
      `Reached question ${prog.answered}`,
      `Score: ${this.score}`,
      `Correct: ${prog.correct}/${prog.answered} (${pct}%)`,
      `Time: ${elapsed}s`,
      `Attempt ${this.attemptNumber}`,
    ].join('\n'), {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
      color: '#e2e8f0', align: 'center',
    }).setOrigin(0.5).setDepth(501)

    this._makeButton(cx - 90, cy + 90, 'Play Again', 0x22d3ee,
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
      color: '#0c1220', fontStyle: 'bold',
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
      tickMs: this.initialTickMs,
    })
  }

  _goBackToPicker() {
    const prog = this.qd.getProgress()
    this.onSessionEnd({
      score: this.score,
      hearts: this.snake ? this.snake.length : 0,
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
    this.input.keyboard.on('keydown-P', () => this._togglePause())
    this.input.keyboard.on('keydown-ESC', () => this._togglePause())

    const onVis = () => {
      if (document.hidden && !this._isPaused && !this.ended) this._pause()
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
    this._pauseOverlay?.show({
      onResume: () => this._resume(),
      onQuit: () => this._quitToPicker(),
    })
    this.input.enabled = true
    if (this.input.keyboard) this.input.keyboard.enabled = true
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
    const prog = this.qd.getProgress()
    this.onSessionEnd({
      score: this.score,
      hearts: this.snake ? this.snake.length : 0,
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
    if (this.autoPlay || this._didInitialCountdown) return
    this._didInitialCountdown = true
    this._readingPauseUntil = this.time.now + ms
    this._hideReadyBadge()
    const badge = this.add.text(GAME_W - 16, GRID_TOP - 22, 'Ready…', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
      color: '#67e8f9', fontStyle: 'bold',
      backgroundColor: '#0f172a', padding: { x: 10, y: 4 },
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
