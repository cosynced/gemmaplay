// SnakeKnowledgeScene
//
// Standalone Phaser 3 scene: classic Snake where the 4 food tiles are the
// A/B/C/D answer options. Eat the correct one to grow and advance; eating
// a wrong one shrinks the snake and costs a heart.
//
// Contract matches the other new scenes:
//   init(data): { game, lesson, sessionId, onSessionEnd }
//     game.game_type = 'snake_knowledge'
//   onSessionEnd({ score, hearts, time_seconds, hintsUsed })
//
// Note on grid dimensions: the spec calls for 32 × 16 cells. On a 540px
// canvas with a 60px HUD + 40px question strip, 16 rows × 30px = 480 would
// overflow. We use 32 × 14 to fit cleanly below the top strip.

import { incrementAttempts } from '../utils/attemptCounter.js'
import { QuestionDispatcher } from '../utils/questionDispatcher.js'
import {
  clearGameState,
  loadGameState,
  saveGameState,
} from '../utils/gameStatePersist.js'
import { snakeAutoPlay } from './AutoPlayAdapter.js'
import { addHudPauseButton, createPauseOverlay } from './PauseOverlay.js'

const GAME_W = 960
const GAME_H = 540
const TILE = 30
const COLS = 32
const ROWS = 14
const HUD_H = 60
const QUESTION_H = 40
const GRID_TOP = HUD_H + QUESTION_H         // y=100
const GRID_LEFT = 0
const GRID_BOTTOM = GRID_TOP + ROWS * TILE  // y=520
const START_TICK_MS = 400
const MIN_TICK_MS = 200
const PER_CORRECT_TICK_DELTA = 5        // ms shaved per correct answer
const READING_PAUSE_MS = 2000

const COLOR = {
  bg: 0x0c1220,
  hud: 0x0f172a,
  stroke: 0x1e293b,
  grid: 0x0f172a,
  gridLine: 0x1e293b,
  head: 0x0ea5e9,
  body: 0x38bdf8,
  tail: 0x0284c7,
  dimmed: 0x475569,
  A: 0x0ea5e9,
  B: 0xa855f7,
  C: 0xfacc15,
  D: 0x10b981,
  textHex: '#e2e8f0',
  heartsHex: '#ef4444',
}

const LETTER_KEYS = ['A', 'B', 'C', 'D']

function cellX(col) { return GRID_LEFT + col * TILE + TILE / 2 }
function cellY(row) { return GRID_TOP + row * TILE + TILE / 2 }

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
      if (this.scoreText) this.scoreText.setText(`Score: ${this.score}`)
      if (this.heartsText) this._renderHearts()
      if (this.snake && this.snakeSprites !== undefined) this._renderSnake()
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

    const makeFoodTile = (color, key, dimmed = false) => {
      g.fillStyle(color)
      g.fillRoundedRect(0, 0, TILE - 2, TILE - 2, 5)
      g.lineStyle(1, 0xffffff, dimmed ? 0.2 : 0.55)
      g.strokeRoundedRect(1, 1, TILE - 4, TILE - 4, 5)
      g.generateTexture(key, TILE - 2, TILE - 2)
      g.clear()
    }
    makeFoodTile(COLOR.A, 'snake-food-A')
    makeFoodTile(COLOR.B, 'snake-food-B')
    makeFoodTile(COLOR.C, 'snake-food-C')
    makeFoodTile(COLOR.D, 'snake-food-D')
    makeFoodTile(COLOR.dimmed, 'snake-food-dimmed', true)

    // Snake head — cyan rounded cell with a small eye dot
    g.fillStyle(COLOR.head)
    g.fillRoundedRect(0, 0, TILE - 2, TILE - 2, 6)
    g.fillStyle(0xffffff)
    g.fillCircle(TILE - 10, 10, 2)
    g.generateTexture('snake-head', TILE - 2, TILE - 2)
    g.clear()

    // Snake body — lighter cyan cell, tinted per segment for gradient
    g.fillStyle(COLOR.body)
    g.fillRoundedRect(0, 0, TILE - 2, TILE - 2, 4)
    g.generateTexture('snake-body', TILE - 2, TILE - 2)
    g.clear()

    g.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    // Play field background
    this.add.rectangle(
      GAME_W / 2,
      GRID_TOP + (ROWS * TILE) / 2,
      COLS * TILE,
      ROWS * TILE,
      COLOR.grid,
      0.5,
    ).setStrokeStyle(1, COLOR.stroke)

    // Faint grid lines for visual grounding
    for (let c = 1; c < COLS; c++) {
      const x = GRID_LEFT + c * TILE
      this.add.rectangle(x, GRID_TOP + (ROWS * TILE) / 2, 1, ROWS * TILE, COLOR.gridLine, 0.25)
    }
    for (let r = 1; r < ROWS; r++) {
      const y = GRID_TOP + r * TILE
      this.add.rectangle(GRID_LEFT + (COLS * TILE) / 2, y, COLS * TILE, 1, COLOR.gridLine, 0.25)
    }

    this._buildHUD()

    // Snake: 3 segments in the middle, moving right
    const startRow = Math.floor(ROWS / 2)
    const startCol = Math.floor(COLS / 2)
    this.snake = [
      { col: startCol, row: startRow },
      { col: startCol - 1, row: startRow },
      { col: startCol - 2, row: startRow },
    ]
    this.snakeSprites = []
    this._renderSnake()

    this.dir = 'right'
    this.nextDir = 'right'
    this.tickMs = this.initialTickMs
    this.lastTickAt = 0

    this.foods = []

    // Tooltip that floats above the food closest to the head
    this.tooltipLabel = this.add.text(0, 0, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px',
      color: '#0c1220', backgroundColor: '#facc15',
      padding: { x: 6, y: 3 }, wordWrap: { width: 220 }, align: 'center',
    }).setOrigin(0.5, 1).setDepth(300).setVisible(false)

    this._setupInput()

    // Restore a prior run if found. Must happen before _startLevel so
    // restored state is respected when the first question loads.
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

    if (this.autoPlay) this._autoPlayCtl = snakeAutoPlay(this)
  }

  _renderSnake() {
    for (const s of this.snakeSprites) s.destroy()
    this.snakeSprites = []
    const n = this.snake.length
    for (let i = 0; i < n; i++) {
      const seg = this.snake[i]
      const isHead = i === 0
      const sprite = this.add.image(cellX(seg.col), cellY(seg.row),
        isHead ? 'snake-head' : 'snake-body').setDepth(isHead ? 60 : 55)
      if (!isHead && n > 1) {
        const t = (i - 1) / Math.max(n - 2, 1)
        const r = Math.round(0x38 + (0x02 - 0x38) * t)
        const gg = Math.round(0xbd + (0x84 - 0xbd) * t)
        const b = Math.round(0xf8 + (0xc7 - 0xf8) * t)
        sprite.setTint((r << 16) | (gg << 8) | b)
      }
      this.snakeSprites.push(sprite)
    }
  }

  // ---------- HUD ----------

  _buildHUD() {
    this.hudBar = this.add.rectangle(GAME_W / 2, HUD_H / 2, GAME_W, HUD_H, COLOR.hud, 0.95)
      .setStrokeStyle(1, COLOR.stroke).setDepth(200)
    this.scoreText = this.add.text(16, HUD_H / 2, 'Score: 0', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px', color: COLOR.textHex,
    }).setOrigin(0, 0.5).setDepth(201)
    this.questionCounterText = this.add.text(
      160, HUD_H / 2, 'Question 1',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px',
        color: '#f1f5f9', fontStyle: 'bold' },
    ).setOrigin(0, 0.5).setDepth(201)
    this.heartsText = this.add.text(GAME_W - 16, HUD_H / 2, 'Length: 3', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color: '#f1f5f9',
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setDepth(201)
    this.qBar = this.add.rectangle(GAME_W / 2, HUD_H + QUESTION_H / 2, GAME_W, QUESTION_H, COLOR.hud, 0.85)
      .setStrokeStyle(1, COLOR.stroke).setDepth(200)
    this.questionText = this.add.text(GAME_W / 2, HUD_H + QUESTION_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: COLOR.textHex,
      wordWrap: { width: GAME_W - 40 }, align: 'center',
    }).setOrigin(0.5).setDepth(201)
  }

  _renderHearts() {
    this.heartsText.setText(`Length: ${this.snake ? this.snake.length : 0}`)
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

    // Pointer swipe (mouse + touch)
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
        this._handleSwipe(dx > 0 ? 'right' : 'left')
      } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
        this._handleSwipe(dy > 0 ? 'down' : 'up')
      }
      this._pointerStart = null
    })
  }

  _handleSwipe(dir) {
    this._tryTurn(dir)
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
      // Dispatcher auto-reshuffles, but belt-and-braces: loop instead of
      // ending. Game only ends on wall / self / length-0.
      this.qd.shuffleRemaining()
      q = this.qd.current()
      if (!q) return
    }
    this.activeQuestion = q
    this.questionText.setText(q.q)
    if (this.questionCounterText) {
      const answered = this.qd ? this.qd.getProgress().answered : 0
      this.questionCounterText.setText(`Question ${answered + 1}`)
    }
    this._clearFoods()
    this._spawnFoods()
    // Freeze the snake for 2s so the student can read the question and
    // scan the food tiles before they have to commit to a direction.
    this._beginReadingPause(READING_PAUSE_MS)
  }

  _clearFoods() {
    for (const f of this.foods) {
      this.tweens.killTweensOf(f.sprite)
      f.sprite.destroy()
      f.letterLabel.destroy()
    }
    this.foods = []
  }

  // ---------- Food ----------

  _randomEmptyCell() {
    const occupied = new Set()
    for (const s of this.snake) occupied.add(`${s.col},${s.row}`)
    for (const f of this.foods) occupied.add(`${f.col},${f.row}`)
    for (let attempt = 0; attempt < 200; attempt++) {
      const col = Phaser.Math.Between(0, COLS - 1)
      const row = Phaser.Math.Between(0, ROWS - 1)
      if (!occupied.has(`${col},${row}`)) return { col, row }
    }
    return null
  }

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

    for (let idx = 0; idx < 4; idx++) {
      const cell = this._randomEmptyCell()
      if (!cell) continue
      const dimmed = hidden.has(idx)
      this._spawnFood(idx, cell.col, cell.row, dimmed)
    }
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
        duration: 600,
        yoyo: true,
        repeat: -1,
      })
    }
    this.foods.push(food)
  }

  // ---------- Game loop ----------

  update(time) {
    if (this.ended) return
    if (this._isPaused) {
      this._resumedPendingReset = true
      return
    }
    if (this._isReading()) {
      // Also queue a post-pause anchor reset so the snake doesn't fire a
      // "catch-up" tick the instant the reading pause ends.
      this._resumedPendingReset = true
      return
    }
    if (this._resumedPendingReset) {
      // Phaser's `time` kept advancing during pause; reset the tick anchor
      // so the snake waits a full tickMs before its next move instead of
      // lurching forward.
      this._resumedPendingReset = false
      this.lastTickAt = time
    }
    if (time - this.lastTickAt < this.tickMs) {
      this._updateTooltip()
      return
    }
    this.lastTickAt = time
    this._tick()
  }

  _tick() {
    this.dir = this.nextDir
    const head = this.snake[0]
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.dir]
    const newHead = { col: head.col + d[0], row: head.row + d[1] }

    // Wall collision
    if (newHead.col < 0 || newHead.col >= COLS || newHead.row < 0 || newHead.row >= ROWS) {
      this._flash(0xef4444)
      return this._endSession()
    }
    // Self collision (exclude tail — it moves on a normal step)
    for (let i = 0; i < this.snake.length - 1; i++) {
      const seg = this.snake[i]
      if (seg.col === newHead.col && seg.row === newHead.row) {
        this._flash(0xef4444)
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
    this._renderSnake()
    this._updateTooltip()
  }

  _updateTooltip() {
    if (!this.snake.length || !this.foods.length || !this.activeQuestion) {
      this.tooltipLabel.setVisible(false)
      return
    }
    const head = this.snake[0]
    let closest = null
    let bestDist = Infinity
    for (const f of this.foods) {
      const dist = Math.abs(f.col - head.col) + Math.abs(f.row - head.row)
      if (dist < bestDist) { bestDist = dist; closest = f }
    }
    if (!closest || bestDist > 3) {
      this.tooltipLabel.setVisible(false)
      return
    }
    const opt = this.activeQuestion.options[closest.letterIdx] ?? ''
    this.tooltipLabel.setText(`${closest.letter}: ${opt}`)
    const fx = cellX(closest.col)
    let fy = cellY(closest.row) - TILE / 2 - 4
    if (fy < GRID_TOP + 14) fy = cellY(closest.row) + TILE / 2 + 14
    this.tooltipLabel.setPosition(fx, fy).setVisible(true)
  }

  // ---------- Resolution ----------

  _resolveFood(food, foodIdx) {
    const q = this.activeQuestion
    const isCorrect = food.letterIdx === q.answer_index
    this.qd.submitAnswer(food.letterIdx)

    if (isCorrect) {
      // Correct — head already moved onto the food cell; no tail pop ⇒ grow by 1.
      this._destroyFood(food, foodIdx)
      this.score += 10
      this.scoreText.setText(`Score: ${this.score}`)
      this.tickMs = Math.max(MIN_TICK_MS, this.tickMs - PER_CORRECT_TICK_DELTA)
      this._renderHearts()
      this._flash(0x10b981)
      this.qd.advance()
      this._saveSnapshot()
      this._loadNextQuestion()
    } else {
      // Wrong — shrink by 1. If already at length 1, game over.
      this._destroyFood(food, foodIdx)
      this._flash(0xef4444)
      // After unshift the snake grew by 1. Pop once to restore length, pop
      // again to shrink by 1.
      this.snake.pop()
      this.snake.pop()
      this._renderHearts()
      if (this.snake.length < 1) return this._endSession()

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
    food.sprite.destroy()
    food.letterLabel.destroy()
    this.foods.splice(foodIdx, 1)
  }

  // ---------- Visual helpers ----------

  _flash(color) {
    if (this.autoPlay) return
    this.cameras.main.flash(160, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(GAME_W / 2, HUD_H + QUESTION_H + 6, text, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color,
      backgroundColor: '#0f172a', padding: { x: 12, y: 4 },
    }).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: HUD_H + QUESTION_H - 4, duration, delay: 200,
      onComplete: () => t.destroy(),
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

    this._makeButton(cx - 90, cy + 90, 'Play Again', 0x0ea5e9,
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
    this._pauseButton = addHudPauseButton(this, {
      x: GAME_W - 28,
      y: HUD_H / 2,
      onClick: () => this._togglePause(),
      depth: 210,
    })
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
    // Only pause once — before the very first question of the session.
    if (this.autoPlay || this._didInitialCountdown) return
    this._didInitialCountdown = true
    this._readingPauseUntil = this.time.now + ms
    this._hideReadyBadge()
    const badge = this.add.text(GAME_W - 16, HUD_H + QUESTION_H + 8, 'Ready…', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
      color: '#0ea5e9', fontStyle: 'bold',
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
