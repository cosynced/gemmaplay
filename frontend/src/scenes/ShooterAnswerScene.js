// ShooterAnswerScene
//
// Standalone Phaser 3 scene: Space-Invaders-style answer shooter. Four
// labeled letter boxes (A/B/C/D) descend from above with their option text.
// A ship at the bottom fires bullets upward. Shooting the letter whose
// letterIdx matches the current question's answer_index clears the wave
// and advances. Shooting a wrong letter costs a heart; the wrong letter
// respawns from the top. Letters reaching the bottom also cost a heart and
// respawn from the top.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd }
//     game.game_type = 'shooter_answer'
//     see Session 1/2 for the shared lesson + game shape.

import { incrementAttempts } from '../utils/attemptCounter.js'
import { QuestionDispatcher } from '../utils/questionDispatcher.js'
import {
  clearGameState,
  loadGameState,
  saveGameState,
} from '../utils/gameStatePersist.js'
import { shooterAutoPlay } from './AutoPlayAdapter.js'
import { addHudPauseButton, createPauseOverlay } from './PauseOverlay.js'

const GAME_W = 960
const GAME_H = 540
const QUESTION_STRIP_H = 80
const HUD_STRIP_H = 30
const PLAY_TOP = 130
const PLAY_BOTTOM = 480
const COL_XS = [120, 360, 600, 840]
const LETTER_BOX = 60
const SHIP_Y = 470
const SHIP_SIZE = 40
const SHIP_SPEED = 400
const BULLET_SPEED = 500
const LETTER_FALL = 10                       // starting descent speed
const LETTER_FALL_CAP = LETTER_FALL * 2.0    // 200% max
const FIRE_INTERVAL = 220
const WAVE_GAP_MS = 5000                      // breathing room between waves
const READING_PAUSE_MS = 2000
const START_HEARTS = 5
const SCORE_CORRECT = 5
const SPEED_BUMP_EVERY_N_Q = 10
const SPEED_BUMP_FACTOR = 1.05                // 5% faster descent every tier

const COLOR = {
  bg: 0x0c1220,
  hud: 0x0f172a,
  stroke: 0x1e293b,
  ship: 0x0ea5e9,
  bullet: 0xfacc15,
  dimmed: 0x475569,
  A: 0x0ea5e9,
  B: 0xa855f7,
  C: 0xfacc15,
  D: 0x10b981,
  heartsHex: '#ef4444',
  textHex: '#e2e8f0',
}

const LETTER_KEYS = ['A', 'B', 'C', 'D']
const LETTER_HEX = ['#0ea5e9', '#a855f7', '#facc15', '#10b981']

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
    this.hearts = START_HEARTS
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false
    this._isPaused = false
    this._pauseStartTs = 0
    this._accumulatedPauseMs = 0
    this._readingPauseUntil = 0
    this._readingBadge = null
    this._didInitialCountdown = false

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
      hearts: this.hearts,
      shipX: this.ship ? this.ship.x : null,
      descentSpeed: this.descentSpeed,
      elapsedMs: Date.now() - this.startTs - (this._accumulatedPauseMs || 0),
      attemptNumber: this.attemptNumber,
      dispatcher: this.qd ? this.qd.snapshot() : null,
    }
  }

  _restore(snap) {
    try {
      if (!snap || !this.qd.restore(snap.dispatcher)) return false
      this.score = snap.score ?? 0
      this.hearts = snap.hearts ?? this.hearts
      this.descentSpeed = snap.descentSpeed ?? this.descentSpeed
      this.startTs = Date.now() - (snap.elapsedMs | 0)
      this._accumulatedPauseMs = 0
      if (snap.attemptNumber) this.attemptNumber = snap.attemptNumber
      if (snap.shipX != null) this._savedShipX = snap.shipX
      if (this.scoreText) this.scoreText.setText(`Score: ${this.score}`)
      if (this.heartsText) this._renderHearts()
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

  // ---------- Preload: generate textures ----------

  preload() {
    const g = this.add.graphics()

    // Ship — cyan triangle pointing up
    g.fillStyle(COLOR.ship)
    g.fillTriangle(SHIP_SIZE / 2, 0, 0, SHIP_SIZE, SHIP_SIZE, SHIP_SIZE)
    g.fillStyle(0xffffff, 0.6)
    g.fillRect(SHIP_SIZE / 2 - 2, SHIP_SIZE / 2 + 2, 4, 8)
    g.generateTexture('sa-ship', SHIP_SIZE, SHIP_SIZE)
    g.clear()

    // Bullet — 4×12 yellow rect
    g.fillStyle(COLOR.bullet)
    g.fillRect(0, 0, 4, 12)
    g.generateTexture('sa-bullet', 4, 12)
    g.clear()

    const makeLetterBox = (color, key) => {
      g.fillStyle(color)
      g.fillRoundedRect(0, 0, LETTER_BOX, LETTER_BOX, 8)
      g.lineStyle(2, 0xffffff, 0.6)
      g.strokeRoundedRect(1, 1, LETTER_BOX - 2, LETTER_BOX - 2, 8)
      g.generateTexture(key, LETTER_BOX, LETTER_BOX)
      g.clear()
    }
    makeLetterBox(COLOR.A, 'sa-letter-A')
    makeLetterBox(COLOR.B, 'sa-letter-B')
    makeLetterBox(COLOR.C, 'sa-letter-C')
    makeLetterBox(COLOR.D, 'sa-letter-D')

    g.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    // Faint star field in the play area
    for (let i = 0; i < 70; i++) {
      const x = Phaser.Math.Between(0, GAME_W)
      const y = Phaser.Math.Between(PLAY_TOP - 10, PLAY_BOTTOM + 40)
      const r = Phaser.Math.Between(1, 2)
      this.add.circle(x, y, r, 0xffffff, Phaser.Math.FloatBetween(0.2, 0.5))
    }

    this._buildHUD()

    // Ship
    this.ship = this.add.image(GAME_W / 2, SHIP_Y, 'sa-ship').setDepth(50)
    this.lastFireTs = 0

    this.bullets = []
    this.letters = []

    // Input (poll in update for continuous movement + firing)
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

      // Pointer (mouse + touch): drag to steer, tap a letter to target-fire,
      // tap elsewhere or swipe up to fire straight.
      this.input.on('pointerdown', (p) => {
        this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
        this._pointerDown = true
        this._dragShipTo(p.x)
      })
      this.input.on('pointermove', (p) => {
        if (this._pointerDown) this._dragShipTo(p.x)
      })
      this.input.on('pointerup', (p) => {
        this._pointerDown = false
        if (this.ended || !this._pointerStart) { this._pointerStart = null; return }
        const dx = p.x - this._pointerStart.x
        const dy = p.y - this._pointerStart.y
        const dt = Date.now() - this._pointerStart.t
        const SWIPE_THRESHOLD = 30
        const TAP_MAX_MOVE = 10
        const TAP_MAX_TIME = 250

        if (Math.abs(dx) < TAP_MAX_MOVE && Math.abs(dy) < TAP_MAX_MOVE && dt < TAP_MAX_TIME) {
          this._handleTap(p.x, p.y)
        } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
          this._handleSwipe(dx > 0 ? 'right' : 'left')
        } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
          this._handleSwipe(dy > 0 ? 'down' : 'up')
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

  _dragShipTo(x) {
    if (this.ended || !this.ship) return
    this.ship.x = Phaser.Math.Clamp(x, 30, GAME_W - 30)
  }

  _handleSwipe(dir) {
    if (dir === 'up') this._fireStraight()
  }

  _handleTap(x, y) {
    // If the tap hits a falling letter, fire a targeted bullet at it.
    for (const L of this.letters) {
      if (Math.abs(L.sprite.x - x) < LETTER_BOX / 2 &&
          Math.abs(L.y - y) < LETTER_BOX / 2) {
        this._fireAt(L.sprite.x, L.y)
        return
      }
    }
    // Otherwise: treat as fire-straight-up.
    this._fireStraight()
  }

  _buildHUD() {
    // Question strip (top)
    this.qBar = this.add.rectangle(GAME_W / 2, QUESTION_STRIP_H / 2, GAME_W, QUESTION_STRIP_H, COLOR.hud, 0.95)
      .setStrokeStyle(1, COLOR.stroke).setDepth(200)
    this.questionText = this.add.text(GAME_W / 2, QUESTION_STRIP_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color: COLOR.textHex,
      wordWrap: { width: GAME_W - 40 }, align: 'center',
    }).setOrigin(0.5).setDepth(201)

    // HUD strip (below question strip)
    this.hudBar = this.add.rectangle(
      GAME_W / 2, QUESTION_STRIP_H + HUD_STRIP_H / 2, GAME_W, HUD_STRIP_H, COLOR.hud, 0.85,
    ).setStrokeStyle(1, COLOR.stroke).setDepth(200)

    this.scoreText = this.add.text(16, QUESTION_STRIP_H + HUD_STRIP_H / 2, 'Score: 0', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: COLOR.textHex,
    }).setOrigin(0, 0.5).setDepth(201)

    this.questionCounterText = this.add.text(
      130, QUESTION_STRIP_H + HUD_STRIP_H / 2, 'Question 1',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
        color: COLOR.textHex, fontStyle: 'bold' },
    ).setOrigin(0, 0.5).setDepth(201)

    this.heartsText = this.add.text(GAME_W - 60, QUESTION_STRIP_H + HUD_STRIP_H / 2,
      Array(START_HEARTS).fill('\u2665').join(' '), {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px', color: COLOR.heartsHex,
    }).setOrigin(1, 0.5).setDepth(201)

  }

  _renderHearts() {
    const n = Math.max(this.hearts, 0)
    this.heartsText.setText(n > 0 ? Array(n).fill('\u2665').join(' ') : '—')
  }

  // ---------- Level lifecycle ----------

  _startLevel() {
    this.descentSpeed = LETTER_FALL
    this._loadNextQuestion()
    if (!this.activeQuestion) return
    this._spawnWave()
  }

  _loadNextQuestion() {
    // Dispatcher is infinite: auto-reshuffles on exhaustion. If we somehow
    // still get null, loop back to the first question — game only ends at
    // 0 lives.
    let q = this.qd.current()
    if (!q) {
      this.qd.shuffleRemaining()
      q = this.qd.current()
    }
    if (!q) { this.activeQuestion = null; return }
    this.activeQuestion = q
    this.questionText.setText(q.q)
    if (this.questionCounterText) {
      const answered = this.qd ? this.qd.getProgress().answered : 0
      this.questionCounterText.setText(`Question ${answered + 1}`)
    }
  }

  _clearLetters() {
    for (const L of this.letters) this._destroyLetter(L)
    this.letters = []
  }

  // ---------- Wave / letter spawning ----------

  _spawnWave() {
    if (!this.activeQuestion) return
    const q = this.activeQuestion

    // Determine which letters to hide this wave (hint)
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
      this._spawnLetter(visibleLetters[i], columns[i], PLAY_TOP)
    }

    // Freeze the letters in place for a beat so the student can read the
    // question and scan the options before anything starts falling.
    this._beginReadingPause(READING_PAUSE_MS)
  }

  _spawnLetter(letterIdx, col, y) {
    const x = COL_XS[col]
    const letter = LETTER_KEYS[letterIdx]
    const sprite = this.add.image(x, y, `sa-letter-${letter}`).setDepth(10)
    const letterLabel = this.add.text(x, y, letter, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '30px',
      color: '#0c1220', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11)
    const opt = (this.activeQuestion && this.activeQuestion.options[letterIdx]) || ''
    const optLabel = this.add.text(x, y + LETTER_BOX / 2 + 10, opt, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px',
      color: LETTER_HEX[letterIdx],
      wordWrap: { width: 150 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(11)
    this.letters.push({ sprite, letterLabel, optLabel, letterIdx, col, y })
  }

  _destroyLetter(L) {
    L.sprite.destroy()
    L.letterLabel.destroy()
    L.optLabel.destroy()
  }

  // ---------- Game loop ----------

  update(_, delta) {
    if (this.ended) return
    if (this._isPaused) return
    if (this._isReading()) return
    const dt = delta / 1000

    if (this.keys) {
      // Ship movement
      const leftDown = this.keys.left.isDown || this.keys.a.isDown
      const rightDown = this.keys.right.isDown || this.keys.d.isDown
      if (leftDown && !rightDown) this.ship.x -= SHIP_SPEED * dt
      else if (rightDown && !leftDown) this.ship.x += SHIP_SPEED * dt
      this.ship.x = Phaser.Math.Clamp(this.ship.x, 20, GAME_W - 20)

      // Firing
      const fireDown = this.keys.space.isDown || this.keys.up.isDown || this.keys.w.isDown
      if (fireDown) this._fireStraight()
    }

    // Bullets
    const bSurvivors = []
    for (const b of this.bullets) {
      b.sprite.x += b.vx * dt
      b.sprite.y += b.vy * dt
      if (b.sprite.y < PLAY_TOP - 20 ||
          b.sprite.x < -20 || b.sprite.x > GAME_W + 20) {
        b.sprite.destroy()
        continue
      }
      bSurvivors.push(b)
    }
    this.bullets = bSurvivors

    // Letters (fall + bottom respawn)
    const lSurvivors = []
    for (const L of this.letters) {
      L.y += this.descentSpeed * dt
      if (L.y >= PLAY_BOTTOM) {
        this.hearts -= 1
        this._renderHearts()
        this._flash(0xef4444)
        if (this.hearts <= 0) {
          this._destroyLetter(L)
          this._endSession()
          return
        }
        L.y = PLAY_TOP
      }
      L.sprite.y = L.y
      L.letterLabel.y = L.y
      L.optLabel.y = L.y + LETTER_BOX / 2 + 10
      lSurvivors.push(L)
    }
    this.letters = lSurvivors

    // Collision: bullet vs letter
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi]
      for (let li = this.letters.length - 1; li >= 0; li--) {
        const L = this.letters[li]
        if (Math.abs(b.sprite.x - L.sprite.x) < LETTER_BOX / 2 &&
            Math.abs(b.sprite.y - L.y) < LETTER_BOX / 2) {
          b.sprite.destroy()
          this.bullets.splice(bi, 1)
          this._handleHit(L, li)
          break
        }
      }
    }
  }

  _fireStraight() {
    if (!this._canFire()) return
    const sprite = this.add.image(this.ship.x, SHIP_Y - SHIP_SIZE / 2 - 4, 'sa-bullet').setDepth(20)
    this.bullets.push({ sprite, vx: 0, vy: -BULLET_SPEED })
    this.lastFireTs = Date.now()
  }

  _fireAt(targetX, targetY) {
    if (!this._canFire()) return
    const srcX = this.ship.x
    const srcY = SHIP_Y - SHIP_SIZE / 2 - 4
    const dx = targetX - srcX
    const dy = targetY - srcY
    const len = Math.max(Math.hypot(dx, dy), 1)
    const vx = (dx / len) * BULLET_SPEED
    const vy = (dy / len) * BULLET_SPEED
    const sprite = this.add.image(srcX, srcY, 'sa-bullet').setDepth(20)
    sprite.setRotation(Math.atan2(vy, vx) + Math.PI / 2)
    this.bullets.push({ sprite, vx, vy })
    this.lastFireTs = Date.now()
  }

  _canFire() {
    return Date.now() - this.lastFireTs >= FIRE_INTERVAL
  }

  // ---------- Resolution ----------

  _handleHit(L, li) {
    const q = this.activeQuestion
    const isCorrect = L.letterIdx === q.answer_index
    this.qd.submitAnswer(L.letterIdx)

    if (isCorrect) {
      this.letters.splice(li, 1)
      this._explodeLetter(L)
      for (const other of this.letters) {
        this.tweens.add({
          targets: [other.sprite, other.letterLabel, other.optLabel],
          alpha: 0, duration: 250,
          onComplete: () => this._destroyLetter(other),
        })
      }
      this.letters = []
      this.score += SCORE_CORRECT
      this.scoreText.setText(`Score: ${this.score}`)
      this._flash(0x10b981)
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
      // Wrong shot: cost a life, respawn the letter so the wave is still solvable.
      const letterIdx = L.letterIdx
      const col = L.col
      this.letters.splice(li, 1)
      this._explodeLetter(L)
      this.hearts -= 1
      this._renderHearts()
      this._flash(0xef4444)
      if (this.hearts <= 0) return this._endSession()
      this.time.delayedCall(500, () => {
        if (this.ended) return
        this._spawnLetter(letterIdx, col, PLAY_TOP)
      })
    }
  }

  _maybeSpeedBump() {
    const answered = this.qd.getProgress().answered
    if (answered > 0 && answered % SPEED_BUMP_EVERY_N_Q === 0) {
      const next = Math.min(LETTER_FALL_CAP, this.descentSpeed * SPEED_BUMP_FACTOR)
      if (next > this.descentSpeed) {
        this.descentSpeed = next
        this._banner('Descent +5%', '#f59e0b')
      }
    }
  }

  // ---------- Visual helpers ----------

  _explodeLetter(L) {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2
      const c = this.add.circle(L.sprite.x, L.y, 3, 0xffffff, 0.95).setDepth(30)
      this.tweens.add({
        targets: c,
        x: L.sprite.x + Math.cos(ang) * 42,
        y: L.y + Math.sin(ang) * 42,
        alpha: 0,
        scale: 0.2,
        duration: 420,
        onComplete: () => c.destroy(),
      })
    }
    this._destroyLetter(L)
  }

  _flash(color) {
    if (this.autoPlay) return
    this.cameras.main.flash(160, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(
      GAME_W / 2, QUESTION_STRIP_H + HUD_STRIP_H + 8, text, {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '15px', color,
        backgroundColor: '#0f172a', padding: { x: 12, y: 4 },
      },
    ).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: QUESTION_STRIP_H + HUD_STRIP_H - 4, duration, delay: 200,
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
    })
  }

  _goBackToPicker() {
    const prog = this.qd.getProgress()
    this.onSessionEnd({
      score: this.score,
      hearts: Math.max(this.hearts, 0),
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
      y: QUESTION_STRIP_H + HUD_STRIP_H / 2,
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
      hearts: Math.max(this.hearts, 0),
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
    // Only pause once — before the very first wave of the session.
    if (this.autoPlay || this._didInitialCountdown) return
    this._didInitialCountdown = true
    this._readingPauseUntil = this.time.now + ms
    this._hideReadyBadge()
    const badge = this.add.text(
      GAME_W - 16,
      QUESTION_STRIP_H + HUD_STRIP_H + 8,
      'Ready…',
      {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
        color: '#0ea5e9', fontStyle: 'bold',
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
