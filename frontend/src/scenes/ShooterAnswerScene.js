// ShooterAnswerScene
//
// Retro pixel-art Space-Invaders-style answer shooter. A chunky defender
// ship at the bottom, four invader enemies descending with A/B/C/D labels
// overlaid, a parallax starfield, and a health bar instead of hearts.
// Shoot the enemy whose letter matches the question's correct answer.
// Wrong shots do NOT destroy the enemy — the bullet is absorbed and the
// enemy keeps descending. Health only drains when an enemy touches the
// ship. Every 2 consecutive correct answers regenerate 1 health up to
// the cap.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd, autoPlay? }

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
import { shooterAutoPlay } from './AutoPlayAdapter.js'
import { createPauseOverlay } from './PauseOverlay.js'

// ---------- Layout ----------

const GAME_W = 960
const GAME_H = 540

// Shared AnswerGridHUD at the top, then a thin HUD strip beneath it, then
// the play area.
const GRID_HUD_TOP = 8
const GRID_HUD_OPTS = {
  questionHeight: 34,
  cellHeight: 38,
  gap: 6,
  padding: 14,
  questionFontSize: 13,
  optionFontSize: 12,
  optionLines: 2,
  chipSize: 26,
  chipLetterSize: 14,
}
const GRID_HUD_BOTTOM = 8 + 34 + 10 + 2 * 38 + 6 // 134
const HUD_STRIP_H = 30
const HUD_STRIP_TOP = GRID_HUD_BOTTOM + 6       // 140
const PLAY_TOP = HUD_STRIP_TOP + HUD_STRIP_H + 5 // 175
const PLAY_BOTTOM = 490
const COL_XS = [120, 360, 600, 840]
const SHIP_Y = 480
const SHIP_SPEED = 400
const BULLET_SPEED = 520

// ---------- Pixel-art sprites ----------

const PIXEL = 3
const SHIP_PIXELS = [
  '......A......',
  '.....AMA.....',
  '....MMMMM....',
  '..MMMMMMMMM..',
  '.MMMMMMMMMMM.',
  'MMMMMMMMMMMMM',
  'MMM.MMMMM.MMM',
  'MM.........MM',
]
const ENEMY_PIXELS = [
  'X........X',
  '.X......X.',
  '.XXXXXXXX.',
  'XX.XXXX.XX',
  'XXXXXXXXXX',
  'X.XXXXXX.X',
  'X.X....X.X',
  '..XX..XX..',
]
const SHIP_TEX_W = SHIP_PIXELS[0].length * PIXEL  // 39
const SHIP_TEX_H = SHIP_PIXELS.length * PIXEL     // 24
const ENEMY_TEX_W = ENEMY_PIXELS[0].length * PIXEL // 30
const ENEMY_TEX_H = ENEMY_PIXELS.length * PIXEL    // 24

const COLOR = {
  bg: 0x0a0f1c,
  hud: 0x0f172a,
  stroke: 0x1e293b,
  shipBody: 0x06b6d4,
  shipAccent: 0xf59e0b,
  bullet: 0x67e8f9,
  starA: 0xffffff,
  starB: 0x94a3b8,
  textHex: '#e2e8f0',
  healthGreen: 0x10b981,
  healthAmber: 0xf59e0b,
  healthRed: 0xef4444,
}

const LETTER_KEYS = ['A', 'B', 'C', 'D']

// ---------- Gameplay tuning ----------

const FIRE_INTERVAL = 150
const DESCENT_SECONDS_START = 15
const DESCENT_SECONDS_FLOOR = 8
const DESCENT_SPEED_FACTOR = 0.96   // descent time × 0.96 per correct
const READING_PAUSE_MS = 2000
const MAX_HEALTH = 20
const START_HEALTH = 20
const REGEN_EVERY_N_CORRECT = 2
const SCORE_CORRECT = 10
const WAVE_GAP_MS = 800
const WOBBLE_AMPLITUDE = 12
const WOBBLE_PERIOD_MS = 1800

// ---------- Pixel texture helpers ----------

function pixelTexture(scene, key, pattern, colorByChar) {
  if (scene.textures.exists(key)) return
  const rows = pattern.length
  const cols = pattern[0].length
  const g = scene.make.graphics({ x: 0, y: 0, add: false })
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = pattern[r][c]
      const color = colorByChar[ch]
      if (color == null) continue
      g.fillStyle(color, 1)
      g.fillRect(c * PIXEL, r * PIXEL, PIXEL, PIXEL)
    }
  }
  g.generateTexture(key, cols * PIXEL, rows * PIXEL)
  g.destroy()
}

function healthBarColor(ratio) {
  if (ratio > 0.6) return COLOR.healthGreen
  if (ratio > 0.3) return COLOR.healthAmber
  return COLOR.healthRed
}

// ---------- Scene ----------

export class ShooterAnswerScene extends Phaser.Scene {
  constructor() {
    super('ShooterAnswerScene')
  }

  init(data) {
    this.gameData = data.game
    this.lessonData = data.lesson
    this.sessionId = data.sessionId || 'harness'
    this.onSessionEnd = data.onSessionEnd || (() => {})
    this.autoPlay = !!data.autoPlay

    this.score = 0
    this.correctCount = 0
    this.health = START_HEALTH
    this.consecutiveCorrect = 0
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false
    this._isPaused = false
    this._pauseStartTs = 0
    this._accumulatedPauseMs = 0
    this._readingPauseUntil = 0
    this._readingBadge = null
    this._didInitialCountdown = false
    this.waveState = 'idle' // 'idle' | 'active' | 'resolving'
    this.descentSeconds = DESCENT_SECONDS_START

    this.hintPendingForNextWave = false
    this.currentHintUsed = false

    this.qd = new QuestionDispatcher(this.lessonData)

    this._gameId = (this.gameData && this.gameData.game_id) || null
    this.attemptNumber = this.autoPlay ? 0 : incrementAttempts(
      this._gameId || 'shooter_answer_harness'
    )
  }

  _snapshot() {
    return {
      score: this.score,
      correctCount: this.correctCount,
      health: this.health,
      consecutiveCorrect: this.consecutiveCorrect,
      shipX: this.ship ? this.ship.x : null,
      descentSeconds: this.descentSeconds,
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
      this.health = Math.min(Math.max(snap.health ?? START_HEALTH, 0), MAX_HEALTH)
      this.consecutiveCorrect = snap.consecutiveCorrect ?? 0
      this.descentSeconds = snap.descentSeconds ?? DESCENT_SECONDS_START
      this.startTs = Date.now() - (snap.elapsedMs | 0)
      this._accumulatedPauseMs = 0
      if (snap.attemptNumber) this.attemptNumber = snap.attemptNumber
      if (snap.shipX != null) this._savedShipX = snap.shipX
      if (this.scoreText) this.scoreText.setText(`Score: ${this.score}`)
      this._renderHealthBar()
      return true
    } catch (e) {
      console.error('Shooter restore failed', e)
      return false
    }
  }

  _saveSnapshot() {
    if (this.autoPlay || this.ended || !this._gameId) return
    try { saveGameState(this._gameId, this._snapshot()) } catch { /* ignore */ }
  }

  // ---------- Preload: generate pixel-art textures ----------

  preload() {
    pixelTexture(this, 'sa-ship', SHIP_PIXELS, {
      M: COLOR.shipBody,
      A: COLOR.shipAccent,
    })
    for (let i = 0; i < 4; i++) {
      pixelTexture(this, `sa-enemy-${LETTER_KEYS[i]}`, ENEMY_PIXELS, {
        X: OPTION_COLORS[i],
      })
    }

    // Bullet: 3x9 cyan pixel bolt.
    const bg = this.make.graphics({ x: 0, y: 0, add: false })
    bg.fillStyle(COLOR.bullet, 1)
    bg.fillRect(0, 0, 3, 9)
    bg.fillStyle(0xffffff, 1)
    bg.fillRect(1, 0, 1, 3)
    bg.generateTexture('sa-bullet', 3, 9)
    bg.destroy()

    // Star: 1x1 white pixel scaled per-star for variety.
    const sg = this.make.graphics({ x: 0, y: 0, add: false })
    sg.fillStyle(0xffffff, 1)
    sg.fillRect(0, 0, 1, 1)
    sg.generateTexture('sa-star', 1, 1)
    sg.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    this._buildStarfield()
    this._buildHUD()

    // Ship
    this.ship = this.add.image(GAME_W / 2, SHIP_Y, 'sa-ship').setDepth(50)
    this.lastFireTs = 0
    this._muzzleFlash = null

    this.bullets = []
    // `letters` keeps its historical name so shooterAutoPlay still finds
    // the target list.
    this.letters = []

    // Input
    this.keys = null
    this._pointerStart = null
    this._pointerDown = false
    if (!this.autoPlay) {
      this.keys = this.input.keyboard.addKeys({
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        a: Phaser.Input.Keyboard.KeyCodes.A,
        d: Phaser.Input.Keyboard.KeyCodes.D,
        w: Phaser.Input.Keyboard.KeyCodes.W,
        space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      })

      this.input.on('pointerdown', (p) => {
        this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
        this._pointerDown = true
        if (p.y > PLAY_TOP) this._dragShipTo(p.x)
      })
      this.input.on('pointermove', (p) => {
        if (this._pointerDown && p.y > PLAY_TOP) this._dragShipTo(p.x)
      })
      this.input.on('pointerup', (p) => {
        this._pointerDown = false
        if (this.ended || !this._pointerStart) { this._pointerStart = null; return }
        const dx = p.x - this._pointerStart.x
        const dy = p.y - this._pointerStart.y
        const dt = Date.now() - this._pointerStart.t
        const TAP_MAX_MOVE = 10
        const TAP_MAX_TIME = 250
        if (Math.abs(dx) < TAP_MAX_MOVE && Math.abs(dy) < TAP_MAX_MOVE && dt < TAP_MAX_TIME) {
          this._fireStraight()
        }
        this._pointerStart = null
      })
    }

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

    if (restored) {
      if (this.ship && this._savedShipX != null) this.ship.x = this._savedShipX
      this._installPauseControls()
      this.time.delayedCall(0, () => { if (!this.ended) this._pause() })
    } else {
      this._installPauseControls()
    }

    if (this.autoPlay) this._autoPlayCtl = shooterAutoPlay(this)
  }

  _buildStarfield() {
    this._stars = []
    const count = 80
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(0, GAME_W)
      const y = Phaser.Math.Between(0, GAME_H)
      const scale = Phaser.Math.Between(1, 3)
      const speed = Phaser.Math.Between(6, 22) // px/s; parallax layers
      const alpha = Phaser.Math.FloatBetween(0.3, 0.9)
      const s = this.add.image(x, y, 'sa-star').setDepth(1)
        .setScale(scale).setAlpha(alpha)
      if (scale === 1) s.setTintFill(COLOR.starB)
      this._stars.push({ sprite: s, speed })
    }
  }

  _dragShipTo(x) {
    if (this.ended || !this.ship) return
    this.ship.x = Phaser.Math.Clamp(x, SHIP_TEX_W / 2, GAME_W - SHIP_TEX_W / 2)
  }

  // ---------- HUD ----------

  _buildHUD() {
    this.hudBar = this.add.rectangle(
      GAME_W / 2, HUD_STRIP_TOP + HUD_STRIP_H / 2, GAME_W, HUD_STRIP_H, COLOR.hud, 0.85,
    ).setStrokeStyle(1, COLOR.stroke).setDepth(200)

    // Health bar (top-left of the HUD strip)
    const hbX = 16
    const hbY = HUD_STRIP_TOP + HUD_STRIP_H / 2 - 7
    const hbW = 200
    const hbH = 14
    this._healthBar = {
      x: hbX, y: hbY, w: hbW, h: hbH,
      frame: this.add.graphics().setDepth(201),
      fill: this.add.graphics().setDepth(202),
    }
    this._renderHealthBar()

    this.scoreText = this.add.text(
      hbX + hbW + 18, HUD_STRIP_TOP + HUD_STRIP_H / 2, 'Score: 0',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: COLOR.textHex },
    ).setOrigin(0, 0.5).setDepth(201)

    this.questionCounterText = this.add.text(
      hbX + hbW + 18 + 120, HUD_STRIP_TOP + HUD_STRIP_H / 2, 'Question 1',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
        color: COLOR.textHex, fontStyle: 'bold' },
    ).setOrigin(0, 0.5).setDepth(201)
  }

  _renderHealthBar() {
    const hb = this._healthBar
    if (!hb) return
    hb.frame.clear()
    hb.frame.lineStyle(2, 0x334155, 1)
    hb.frame.strokeRoundedRect(hb.x, hb.y, hb.w, hb.h, 4)
    hb.fill.clear()
    const ratio = Math.max(0, Math.min(1, this.health / MAX_HEALTH))
    if (ratio <= 0) return
    const segGap = 1
    const segs = MAX_HEALTH
    const segW = (hb.w - 4 - (segs - 1) * segGap) / segs
    const segH = hb.h - 4
    const color = healthBarColor(ratio)
    hb.fill.fillStyle(color, 1)
    for (let i = 0; i < this.health; i++) {
      hb.fill.fillRect(
        hb.x + 2 + i * (segW + segGap),
        hb.y + 2,
        segW,
        segH,
      )
    }
  }

  _flashHealthBar(color) {
    if (!this._healthBar) return
    const pulse = this.add.rectangle(
      this._healthBar.x + this._healthBar.w / 2,
      this._healthBar.y + this._healthBar.h / 2,
      this._healthBar.w + 6,
      this._healthBar.h + 6,
      color,
      0.45,
    ).setDepth(203)
    this.tweens.add({
      targets: pulse, alpha: 0, duration: 280, ease: 'Sine.easeOut',
      onComplete: () => pulse.destroy(),
    })
  }

  // ---------- Level lifecycle ----------

  _startLevel() {
    this._loadNextQuestion()
    if (!this.activeQuestion) return
    this._spawnWave()
  }

  _loadNextQuestion() {
    let q = this.qd.current()
    if (!q) {
      this.qd.shuffleRemaining()
      q = this.qd.current()
    }
    if (!q) { this.activeQuestion = null; return }
    this.activeQuestion = q
    if (this.questionCounterText) {
      const answered = this.qd ? this.qd.getProgress().answered : 0
      this.questionCounterText.setText(`Question ${answered + 1}`)
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
  }

  _clearLetters() {
    for (const L of this.letters) this._destroyLetter(L)
    this.letters = []
  }

  _spawnWave() {
    if (!this.activeQuestion) return
    const q = this.activeQuestion

    let hidden = new Set()
    if (this.hintPendingForNextWave) {
      const wrongs = [0, 1, 2, 3].filter((i) => i !== q.answer_index)
      Phaser.Utils.Array.Shuffle(wrongs)
      hidden = new Set(wrongs.slice(0, 2))
      this.hintPendingForNextWave = false
      this.currentHintUsed = true
    } else {
      this.currentHintUsed = false
    }

    const visibleLetters = [0, 1, 2, 3].filter((i) => !hidden.has(i))
    const columns = [0, 1, 2, 3]
    Phaser.Utils.Array.Shuffle(columns)

    for (let i = 0; i < visibleLetters.length; i++) {
      this._spawnEnemy(visibleLetters[i], columns[i])
    }

    this.waveState = 'active'
    this._beginReadingPause(READING_PAUSE_MS)
  }

  _spawnEnemy(letterIdx, col) {
    const baseX = COL_XS[col]
    const letter = LETTER_KEYS[letterIdx]
    const sprite = this.add.image(baseX, PLAY_TOP, `sa-enemy-${letter}`).setDepth(10)
    const letterLabel = this.add.text(baseX, PLAY_TOP, letter, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '22px',
      color: '#0c1220',
      fontStyle: 'bold',
      stroke: '#ffffff',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11)
    const wobblePhase = Phaser.Math.FloatBetween(0, Math.PI * 2)
    // `sprite.x` / `y` stay stable; `baseX` + phase drive the wobble.
    this.letters.push({
      sprite, letterLabel, letterIdx, col,
      baseX, y: PLAY_TOP, wobblePhase,
    })
  }

  _destroyLetter(L) {
    try { L.sprite.destroy() } catch { /* torn */ }
    try { L.letterLabel.destroy() } catch { /* torn */ }
  }

  // ---------- Game loop ----------

  update(time, delta) {
    if (this.ended) return
    if (this._isPaused) return
    const dt = delta / 1000

    // Starfield drifts regardless of reading pause so the scene breathes.
    for (const s of this._stars) {
      s.sprite.y += s.speed * dt
      if (s.sprite.y > GAME_H + 4) {
        s.sprite.y = -4
        s.sprite.x = Phaser.Math.Between(0, GAME_W)
      }
    }

    if (this._isReading()) return

    if (this.keys) {
      const leftDown = this.keys.left.isDown || this.keys.a.isDown
      const rightDown = this.keys.right.isDown || this.keys.d.isDown
      if (leftDown && !rightDown) this.ship.x -= SHIP_SPEED * dt
      else if (rightDown && !leftDown) this.ship.x += SHIP_SPEED * dt
      this.ship.x = Phaser.Math.Clamp(this.ship.x, SHIP_TEX_W / 2, GAME_W - SHIP_TEX_W / 2)

      const fireDown = this.keys.space.isDown || this.keys.up.isDown || this.keys.w.isDown
      if (fireDown) this._fireStraight()
    }

    // Bullets
    const bSurvivors = []
    for (const b of this.bullets) {
      b.sprite.y += b.vy * dt
      if (b.sprite.y < PLAY_TOP - 20) {
        b.sprite.destroy()
        continue
      }
      bSurvivors.push(b)
    }
    this.bullets = bSurvivors

    // Enemy descent + wobble. Descent speed is derived from descentSeconds
    // so the adaptive rule maps "time to fall" directly.
    const descentSpeed = (PLAY_BOTTOM - PLAY_TOP) / this.descentSeconds
    const wobble = (phase) =>
      Math.sin((time / WOBBLE_PERIOD_MS) * Math.PI * 2 + phase) * WOBBLE_AMPLITUDE

    const lSurvivors = []
    let correctEscaped = false
    for (const L of this.letters) {
      // During wave resolution (correct hit / wave-lost fade), let the
      // fade tweens move the sprites; skip descent + touch detection.
      if (this.waveState !== 'active') {
        lSurvivors.push(L)
        continue
      }
      L.y += descentSpeed * dt
      L.sprite.x = L.baseX + wobble(L.wobblePhase)
      L.sprite.y = L.y
      L.letterLabel.x = L.sprite.x
      L.letterLabel.y = L.y
      if (L.y >= PLAY_BOTTOM) {
        const wasCorrect = this.activeQuestion
          && L.letterIdx === this.activeQuestion.answer_index
        this._onEnemyTouchShip(L)
        if (wasCorrect) correctEscaped = true
        continue
      }
      lSurvivors.push(L)
    }
    this.letters = lSurvivors
    if (this.health <= 0 && !this.ended) {
      return this._endSession()
    }
    if (correctEscaped && this.waveState === 'active') {
      this._endWaveNoCorrect()
    }

    // Bullet vs enemy collision
    if (this.waveState === 'active') {
      for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
        const b = this.bullets[bi]
        for (let li = this.letters.length - 1; li >= 0; li--) {
          const L = this.letters[li]
          if (Math.abs(b.sprite.x - L.sprite.x) < ENEMY_TEX_W / 2
              && Math.abs(b.sprite.y - L.y) < ENEMY_TEX_H / 2) {
            b.sprite.destroy()
            this.bullets.splice(bi, 1)
            this._handleHit(L, li)
            break
          }
        }
      }
    }
  }

  _fireStraight() {
    if (!this._canFire() || !this.ship) return
    const sprite = this.add.image(this.ship.x, SHIP_Y - SHIP_TEX_H / 2 - 2, 'sa-bullet').setDepth(20)
    this.bullets.push({ sprite, vy: -BULLET_SPEED })
    this.lastFireTs = Date.now()
    this._muzzleFlashTick()
  }

  // Kept for the autoplay adapter's targeted-fire calls.
  _fireAt(_targetX, _targetY) {
    this._fireStraight()
  }

  _canFire() {
    return Date.now() - this.lastFireTs >= FIRE_INTERVAL
  }

  _muzzleFlashTick() {
    if (!this.ship) return
    if (this._muzzleFlash) { try { this._muzzleFlash.destroy() } catch { /* ignore */ } }
    const flash = this.add.circle(
      this.ship.x, SHIP_Y - SHIP_TEX_H / 2, 6, 0xfef9c3, 0.9,
    ).setDepth(49)
    this._muzzleFlash = flash
    this.tweens.add({
      targets: flash, scale: 1.8, alpha: 0, duration: 110, ease: 'Sine.easeOut',
      onComplete: () => { try { flash.destroy() } catch { /* ignore */ } },
    })
  }

  // ---------- Resolution ----------

  _handleHit(L, li) {
    const q = this.activeQuestion
    const isCorrect = L.letterIdx === q.answer_index
    this.qd.submitAnswer(L.letterIdx)

    if (isCorrect) {
      this.waveState = 'resolving'
      this.letters.splice(li, 1)
      this._burst(L.sprite.x, L.y, 0x10b981)
      this._destroyLetter(L)
      // Fade remaining enemies (they sink harmlessly).
      for (const other of this.letters) {
        this.tweens.add({
          targets: [other.sprite, other.letterLabel],
          alpha: 0, y: other.y + 40, duration: 320, ease: 'Sine.easeIn',
          onComplete: () => this._destroyLetter(other),
        })
      }
      this.letters = []
      this.score += SCORE_CORRECT
      this.correctCount += 1
      this.consecutiveCorrect += 1
      this.scoreText.setText(`Score: ${this.score}`)
      this._flash(0x10b981)

      if (this.consecutiveCorrect > 0
          && this.consecutiveCorrect % REGEN_EVERY_N_CORRECT === 0
          && this.health < MAX_HEALTH) {
        this.health += 1
        this._renderHealthBar()
        this._flashHealthBar(COLOR.healthGreen)
        this._banner('+1 health', '#10b981')
      }

      this._maybeSpeedBump()
      this.qd.advance()
      this._saveSnapshot()

      this.time.delayedCall(WAVE_GAP_MS, () => {
        if (this.ended) return
        this._loadNextQuestion()
        if (!this.activeQuestion) return
        this._spawnWave()
      })
    } else {
      // Wrong shot: bullet is absorbed, enemy keeps descending. Streak
      // resets and we play a small spark so the player gets feedback,
      // but no health is lost here — the real cost is letting the enemy
      // reach the ship.
      this.consecutiveCorrect = 0
      this._spark(L.sprite.x, L.y, 0xef4444)
      this._flinchEnemy(L)
    }
  }

  _onEnemyTouchShip(L) {
    this.consecutiveCorrect = 0
    this.health -= 1
    this._renderHealthBar()
    this._flashHealthBar(COLOR.healthRed)
    this._flash(0xef4444)
    this.cameras.main.shake(140, 0.004)
    this._burst(L.sprite.x, L.y, 0xef4444)
    this._destroyLetter(L)
  }

  _endWaveNoCorrect() {
    // Correct enemy escaped past the ship; the wave can no longer be
    // resolved via shooting. Clear remaining enemies and advance.
    this.waveState = 'resolving'
    for (const L of this.letters) {
      const lc = L
      this.tweens.add({
        targets: [lc.sprite, lc.letterLabel],
        alpha: 0, y: lc.y + 40, duration: 320, ease: 'Sine.easeIn',
        onComplete: () => this._destroyLetter(lc),
      })
    }
    this.letters = []
    this.qd.advance()
    this._saveSnapshot()
    this.time.delayedCall(WAVE_GAP_MS, () => {
      if (this.ended) return
      this._loadNextQuestion()
      if (!this.activeQuestion) return
      this._spawnWave()
    })
  }

  _flinchEnemy(L) {
    // Brief white pulse so the player can tell the bullet connected but
    // didn't kill. Doesn't move the enemy — descent continues in update.
    if (!L || !L.sprite) return
    this.tweens.add({
      targets: L.sprite,
      scale: { from: 1.15, to: 1 },
      duration: 180,
      ease: 'Sine.easeOut',
    })
  }

  _maybeSpeedBump() {
    // Adaptive rule: each correct answer shortens descent time by 4%
    // (floor DESCENT_SECONDS_FLOOR). Wrong answers leave it alone.
    const next = Math.max(DESCENT_SECONDS_FLOOR, this.descentSeconds * DESCENT_SPEED_FACTOR)
    if (next < this.descentSeconds) {
      this.descentSeconds = next
      this._banner('Speeding up!', '#10b981')
    }
  }

  // ---------- Particle-ish visual helpers ----------

  _burst(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2)
      const dist = Phaser.Math.Between(30, 48)
      const size = PIXEL
      const shard = this.add.rectangle(x, y, size, size, color, 1).setDepth(30)
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        duration: 420,
        ease: 'Sine.easeOut',
        onComplete: () => { try { shard.destroy() } catch { /* ignore */ } },
      })
    }
  }

  _spark(x, y, color) {
    // Small impact shower for "bullet hit but didn't kill".
    for (let i = 0; i < 4; i++) {
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const dist = Phaser.Math.Between(8, 16)
      const shard = this.add.rectangle(x, y, PIXEL, PIXEL, color, 1).setDepth(30)
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        duration: 220,
        ease: 'Sine.easeOut',
        onComplete: () => { try { shard.destroy() } catch { /* ignore */ } },
      })
    }
  }

  _flash(color) {
    if (this.autoPlay) return
    this.cameras.main.flash(140, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1200) {
    const t = this.add.text(
      GAME_W / 2, HUD_STRIP_TOP + HUD_STRIP_H + 8, text, {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '15px', color,
        backgroundColor: '#0f172a', padding: { x: 12, y: 4 },
      },
    ).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: HUD_STRIP_TOP + HUD_STRIP_H - 4, duration, delay: 200,
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
    this._clearLetters()
    if (this._gameId) { try { clearGameState(this._gameId) } catch { /* ignore */ } }
    const cx = GAME_W / 2
    const cy = GAME_H / 2
    this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x0a0f1c, 0.9).setDepth(500)
    this.add.text(cx, cy - 140, 'GAME OVER', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '48px',
      color: '#f87171', fontStyle: 'bold',
      stroke: '#0a0f1c', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(501)
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

    this._makeButton(cx - 90, cy + 90, 'Play Again', 0x06b6d4,
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
      hearts: Math.max(this.health, 0),
      time_seconds: this._effectiveTimeSeconds(),
      hintsUsed: this.hintsUsed,
      questions_answered: prog.answered,
      questions_correct: prog.correct,
      max_streak: prog.max_streak,
    })
  }

  // ---------- Pause ----------

  _buildHudPauseButton() {
    const pauseX = GAME_W - 28
    const pauseY = HUD_STRIP_TOP + HUD_STRIP_H / 2
    const size = 44

    const rect = this.add.rectangle(0, 0, size, size, 0x1e293b, 0.9)
      .setStrokeStyle(1.5, 0xffffff, 0.35)
    rect.setInteractive({ useHandCursor: true })
    rect.setDepth(5000)
    rect.on('pointerover', () => rect.setFillStyle(0x334155, 0.95))
    rect.on('pointerout', () => rect.setFillStyle(0x1e293b, 0.9))
    rect.on('pointerdown', () => {
      console.log('[ShooterAnswerScene] pause button clicked')
      this._togglePause()
    })

    const icon = this.add.graphics()
    icon.fillStyle(0xe2e8f0, 1)
    icon.fillRect(-7, -8, 4, 16)
    icon.fillRect(3, -8, 4, 16)

    const container = this.add.container(pauseX, pauseY, [rect, icon])
    container.setDepth(5000)
    return container
  }

  _installPauseControls() {
    if (this.autoPlay) return
    this._pauseOverlay = createPauseOverlay(this)
    this._pauseButton = this._buildHudPauseButton()
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
      hearts: Math.max(this.health, 0),
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
    const badge = this.add.text(
      GAME_W - 16,
      HUD_STRIP_TOP + HUD_STRIP_H + 8,
      'Ready…',
      {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
        color: '#67e8f9', fontStyle: 'bold',
        backgroundColor: '#0f172a', padding: { x: 10, y: 4 },
      },
    ).setOrigin(1, 0).setDepth(250)
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
