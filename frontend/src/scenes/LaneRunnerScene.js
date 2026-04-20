// LaneRunnerScene
//
// Portrait pseudo-3D lane runner. 4 lanes, answer gates only.
// Score-based survival: start at 10, +2 correct, -1 wrong, 0 = game over.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd, autoPlay? }
//     game   = { game_id, lesson_id, game_type, levels: [
//                 { concept_id, base_speed?, questions: [question_id, ...] }
//               ] }
//     lesson = { concepts: [
//                 { id, name, questions: [{ id, q, options, answer_index }] }
//               ] }
//     sessionId: string
//     onSessionEnd({ score, hearts, time_seconds, hintsUsed })

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
import { laneRunnerAutoPlay } from './AutoPlayAdapter.js'
import { addHudPauseButton, createPauseOverlay } from './PauseOverlay.js'

// Portrait canvas
const GAME_W = 540
const GAME_H = 900
const CX = GAME_W / 2

const LANE_COUNT = 4
const LETTERS = ['A', 'B', 'C', 'D']
const GATE_COLORS = [
  OPTION_COLORS[0],
  OPTION_COLORS[1],
  OPTION_COLORS[2],
  OPTION_COLORS[3],
]

// HUD layout (top)
const PAUSE_SIZE = 44
const PAUSE_X = 20
const PAUSE_Y = 20
const SCORE_PANEL_W = 110
const SCORE_PANEL_H = 52
const SCORE_PANEL_X = GAME_W - SCORE_PANEL_W - 14
const SCORE_PANEL_Y = 14
const QUESTION_PANEL_W = 110
const QUESTION_PANEL_H = SCORE_PANEL_H
const QUESTION_PANEL_X = SCORE_PANEL_X - QUESTION_PANEL_W - 8
const QUESTION_PANEL_Y = SCORE_PANEL_Y

// Shared AnswerGridHUD sits at this y; sized to match the existing layout
// so the road horizon (Y_HORIZON) stays put.
const GRID_BANNER_TOP = 78
const GRID_OPTS = {
  questionHeight: 66,
  cellHeight: 64,
  gap: 8,
  padding: 14,
  questionFontSize: 15,
  optionFontSize: 14,
  chipSize: 36,
  chipLetterSize: 20,
}

// Road geometry
const Y_HORIZON = 306
const Y_BOTTOM = GAME_H                        // 900
const ROAD_H = Y_BOTTOM - Y_HORIZON
const STRIP_COUNT = 56
const HALF_AT_HORIZON = 80
const HALF_AT_BOTTOM = 320
const RUNNER_Y = Math.floor(GAME_H * 0.85)    // 765

// Visual theme
const COLOR_CANVAS_BG = 0x1b2430
const COLOR_ASPHALT_A = 0x4a4a4a
const COLOR_ASPHALT_B = 0x3a3a3a
const COLOR_EDGE = 0xffffff
const COLOR_DIVIDER = 0xfbbf24    // yellow
const COLOR_HUD_FG = '#f8fafc'
const COLOR_HUD_MUTED = '#94a3b8'

// Gameplay tuning
const START_SCORE = 20
const SCORE_CORRECT = 2
const SCORE_WRONG = -1
// No unanswered-streak ending: the only failure condition is score <= 0.
const BASE_TRANSIT_S = 15.0       // gate horizon -> runner seconds
const MIN_TRANSIT_S = 10.0        // floor after speed bumps
const SPEED_BUMP_FACTOR = 0.96    // 4% faster per correct answer
const HARD_Q_SLOWDOWN = 1.10      // 10% slower for hard questions
const READING_PAUSE_MS = 2000
const LANE_CHANGE_MS = 200
const ROAD_SCROLL_RATE = 4.0      // stripes per second

// Depths
const D_ROAD = 5
const D_GATE_BG = 20
const D_GATE_LABEL = 21
const D_RUNNER = 50
const D_HUD = 200
const D_HUD_TEXT = 201
const D_COUNTDOWN = 250

function halfWidthAtY(y) {
  const t = (y - Y_HORIZON) / ROAD_H
  return HALF_AT_HORIZON + (HALF_AT_BOTTOM - HALF_AT_HORIZON) * t
}

function laneCenterAtY(laneIdx, y) {
  const halfW = halfWidthAtY(y)
  const laneW = (halfW * 2) / LANE_COUNT
  return CX + (laneIdx - (LANE_COUNT - 1) / 2) * laneW
}

export class LaneRunnerScene extends Phaser.Scene {
  constructor() {
    super('LaneRunnerScene')
  }

  init(data) {
    this.gameData = data.game
    this.lessonData = data.lesson
    this.sessionId = data.sessionId || 'harness'
    this.onSessionEnd = data.onSessionEnd || (() => {})
    this.autoPlay = !!data.autoPlay

    this.levelIdx = 0
    this.score = START_SCORE
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false

    this._isPaused = false
    this._pauseStartTs = 0
    this._accumulatedPauseMs = 0

    this._readingActive = false
    this._countdownText = null
    this._didInitialCountdown = false
    this._hintShown = false

    this.baseTransitS = BASE_TRANSIT_S
    this.transitSeconds = BASE_TRANSIT_S
    this.scrollOffset = 0

    this.currentLane = 1
    this.runnerTargetX = laneCenterAtY(this.currentLane, RUNNER_Y)
    this.runnerLaneTween = null

    this.activeGates = null     // { progress, question, visuals: [{lane, bg, label, color}], resolving, shuffleMap }
    this.pendingQuestion = null
    this._committing = false

    this.qd = new QuestionDispatcher(this.lessonData)

    this._gameId = (this.gameData && this.gameData.game_id) || null
    this.attemptNumber = this.autoPlay ? 0 : incrementAttempts(
      this._gameId || 'lane_runner_harness',
    )
  }

  _snapshot() {
    return {
      score: this.score,
      currentLane: this.currentLane,
      baseTransitS: this.baseTransitS,
      elapsedMs: Date.now() - this.startTs - (this._accumulatedPauseMs || 0),
      attemptNumber: this.attemptNumber,
      dispatcher: this.qd ? this.qd.snapshot() : null,
    }
  }

  _restore(snap) {
    try {
      if (!snap || !this.qd.restore(snap.dispatcher)) return false
      this.score = snap.score ?? START_SCORE
      this.currentLane = Math.min(Math.max(0, snap.currentLane | 0), LANE_COUNT - 1)
      this.baseTransitS = snap.baseTransitS ?? BASE_TRANSIT_S
      this.startTs = Date.now() - (snap.elapsedMs | 0)
      this._accumulatedPauseMs = 0
      if (snap.attemptNumber) this.attemptNumber = snap.attemptNumber
      return true
    } catch (e) {
      console.error('LaneRunner restore failed', e)
      return false
    }
  }

  _saveSnapshot() {
    if (this.autoPlay || this.ended || !this._gameId) return
    try { saveGameState(this._gameId, this._snapshot()) } catch { /* ignore */ }
  }

  // ---------- Create ----------

  create() {
    // Portrait canvas. setGameSize changes the logical game size; refresh()
    // forces Scale.FIT to re-measure the parent and restyle the canvas.
    if (this.scale.gameSize.width !== GAME_W || this.scale.gameSize.height !== GAME_H) {
      this.scale.setGameSize(GAME_W, GAME_H)
      this.scale.refresh()
    }

    this.cameras.main.setBackgroundColor(COLOR_CANVAS_BG)

    this.roadGraphics = this.add.graphics().setDepth(D_ROAD)

    this._buildRunner()
    this._buildHUD()
    this._setupInput()
    this._installPauseControls()

    // Restore a prior in-progress run if we find one. Pause immediately so
    // the player has to click Resume before anything scrolls.
    let restored = false
    if (!this.autoPlay && this._gameId) {
      const snap = loadGameState(this._gameId)
      if (snap) {
        restored = this._restore(snap)
        if (!restored) clearGameState(this._gameId)
        else {
          // Snap runner visually and refresh score before starting level.
          this.runnerTargetX = laneCenterAtY(this.currentLane, RUNNER_Y)
          if (this.runner) this.runner.x = this.runnerTargetX
          if (this.scoreValue) this._updateScoreText()
        }
      }
    }

    this._startLevel()

    if (restored) {
      // Delay one tick so the reading-pause delayedCalls queue up before
      // we freeze the time system.
      this.time.delayedCall(0, () => { if (!this.ended) this._pause() })
    }

    if (this.autoPlay) this._autoPlayCtl = laneRunnerAutoPlay(this)
  }

  _buildRunner() {
    // Hand-drawn stick figure, procedural Phaser Graphics. Container origin
    // sits at the feet so lane tweens on .x and the bob tween on .y compose
    // cleanly. All children positioned in local coords with y going up (−).
    const STROKE = 0x0f172a
    const STROKE_W = 2.5
    const SHADOW = 0x000000

    const HIP_Y = -22
    const SHOULDER_Y = -46
    const NECK_TOP_Y = -50
    const HEAD_CY = -62
    const HEAD_R = 12
    const ARM_LEN = 18
    const LEG_LEN = 22
    const SHOULDER_X = 7
    const HIP_X = 5

    const runner = this.add.container(this.runnerTargetX, RUNNER_Y).setDepth(D_RUNNER)

    // Ground shadow — sits under the feet, does not animate.
    const shadow = this.add.graphics()
    shadow.fillStyle(SHADOW, 0.28)
    shadow.fillEllipse(0, 2, 32, 8)

    // Legs pivot at the hip: line drawn from local (0,0) downward so
    // setRotation rotates around the hip attachment point.
    const makeLeg = (hipX) => {
      const g = this.add.graphics()
      g.lineStyle(STROKE_W, STROKE, 1)
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(0, LEG_LEN)
      g.strokePath()
      g.fillStyle(STROKE, 1)
      g.fillEllipse(1, LEG_LEN + 1, 8, 3)
      g.setPosition(hipX, HIP_Y)
      return g
    }
    const leftLeg = makeLeg(-HIP_X)
    const rightLeg = makeLeg(HIP_X)

    // Torso.
    const body = this.add.graphics()
    body.lineStyle(STROKE_W, STROKE, 1)
    body.beginPath()
    body.moveTo(0, HIP_Y)
    body.lineTo(0, SHOULDER_Y)
    body.strokePath()

    // Neck.
    const neck = this.add.graphics()
    neck.lineStyle(STROKE_W, STROKE, 1)
    neck.beginPath()
    neck.moveTo(0, SHOULDER_Y)
    neck.lineTo(0, NECK_TOP_Y)
    neck.strokePath()

    // Arms pivot at the shoulder, same construction as legs.
    const makeArm = (shoulderX) => {
      const g = this.add.graphics()
      g.lineStyle(STROKE_W, STROKE, 1)
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(0, ARM_LEN)
      g.strokePath()
      g.fillStyle(STROKE, 1)
      g.fillCircle(0, ARM_LEN, 3)
      g.setPosition(shoulderX, SHOULDER_Y)
      return g
    }
    const leftArm = makeArm(-SHOULDER_X)
    const rightArm = makeArm(SHOULDER_X)

    // Head: face + glasses + hair tuft.
    const head = this.add.graphics()
    head.lineStyle(STROKE_W, STROKE, 1)
    head.strokeCircle(0, HEAD_CY, HEAD_R)

    // Hair tuft: three short spiky strokes, off-center.
    const tuftBaseY = HEAD_CY - HEAD_R + 1
    const tufts = [
      [-4, tuftBaseY - 2, -6, tuftBaseY - 9],
      [0, tuftBaseY - 3, -1, tuftBaseY - 11],
      [4, tuftBaseY - 2, 5, tuftBaseY - 8],
    ]
    head.lineStyle(2, STROKE, 1)
    for (const [x1, y1, x2, y2] of tufts) {
      head.beginPath()
      head.moveTo(x1, y1)
      head.lineTo(x2, y2)
      head.strokePath()
    }

    // Glasses: two circles + bridge.
    head.lineStyle(2, STROKE, 1)
    head.strokeCircle(-4, HEAD_CY - 2, 4)
    head.strokeCircle(4, HEAD_CY - 2, 4)
    head.beginPath()
    head.moveTo(-0.5, HEAD_CY - 2)
    head.lineTo(0.5, HEAD_CY - 2)
    head.strokePath()

    // Eyes: small filled pupils inside the glasses, slight inward tilt.
    head.fillStyle(STROKE, 1)
    head.fillCircle(-3.5, HEAD_CY - 2, 1.4)
    head.fillCircle(3.5, HEAD_CY - 2, 1.4)

    // Smile: arc from 20° to 160° swept clockwise in y-down screen coords
    // traces the bottom of a small circle — a friendly curve from the
    // right corner through the chin dip to the left corner.
    head.lineStyle(STROKE_W, STROKE, 1)
    head.beginPath()
    head.arc(
      0,
      HEAD_CY + 3,
      5,
      Phaser.Math.DegToRad(20),
      Phaser.Math.DegToRad(160),
      false,
    )
    head.strokePath()

    runner.add([shadow, leftLeg, rightLeg, body, neck, leftArm, rightArm, head])

    this.runner = runner
    this.runner._parts = { leftArm, rightArm, leftLeg, rightLeg }

    const ARM_SWING = Phaser.Math.DegToRad(35)
    const LEG_SWING = Phaser.Math.DegToRad(25)
    const DUR = 300

    // Arms: left leads, right phase-offset by half a cycle.
    this.tweens.add({
      targets: leftArm, rotation: { from: -ARM_SWING, to: ARM_SWING },
      duration: DUR, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
    this.tweens.add({
      targets: rightArm, rotation: { from: -ARM_SWING, to: ARM_SWING },
      duration: DUR, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      delay: DUR / 2,
    })
    // Legs opposite the same-side arm so the gait reads naturally.
    this.tweens.add({
      targets: leftLeg, rotation: { from: -LEG_SWING, to: LEG_SWING },
      duration: DUR, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      delay: DUR / 2,
    })
    this.tweens.add({
      targets: rightLeg, rotation: { from: -LEG_SWING, to: LEG_SWING },
      duration: DUR, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
    // Body bob: container ±2px, twice per gait cycle.
    this.tweens.add({
      targets: runner, y: { from: RUNNER_Y - 1, to: RUNNER_Y + 1 },
      duration: DUR, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
  }

  _buildHUD() {
    // Score panel (top-right)
    this.scorePanelBg = this.add.graphics().setDepth(D_HUD)
    this._drawScorePanel()
    this.scoreLabel = this.add.text(
      SCORE_PANEL_X + SCORE_PANEL_W / 2, SCORE_PANEL_Y + 12, 'SCORE',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px',
        color: COLOR_HUD_MUTED, fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(D_HUD_TEXT)
    this.scoreValue = this.add.text(
      SCORE_PANEL_X + SCORE_PANEL_W / 2, SCORE_PANEL_Y + 34, String(this.score),
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '20px',
        color: COLOR_HUD_FG, fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(D_HUD_TEXT)

    // Question counter panel (to the left of score)
    this.questionCounterBg = this.add.graphics().setDepth(D_HUD)
    this._drawQuestionCounterPanel()
    this.questionCounterLabel = this.add.text(
      QUESTION_PANEL_X + QUESTION_PANEL_W / 2, QUESTION_PANEL_Y + 12, 'QUESTION',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px',
        color: COLOR_HUD_MUTED, fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(D_HUD_TEXT)
    this.questionCounterValue = this.add.text(
      QUESTION_PANEL_X + QUESTION_PANEL_W / 2, QUESTION_PANEL_Y + 34, '1',
      { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '20px',
        color: COLOR_HUD_FG, fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(D_HUD_TEXT)

  }

  _drawScorePanel() {
    const g = this.scorePanelBg
    g.clear()
    g.fillStyle(0x0f172a, 0.92)
    g.fillRoundedRect(SCORE_PANEL_X, SCORE_PANEL_Y, SCORE_PANEL_W, SCORE_PANEL_H, 10)
    g.lineStyle(2, 0x334155, 1)
    g.strokeRoundedRect(SCORE_PANEL_X, SCORE_PANEL_Y, SCORE_PANEL_W, SCORE_PANEL_H, 10)
  }

  _drawQuestionCounterPanel() {
    const g = this.questionCounterBg
    g.clear()
    g.fillStyle(0x0f172a, 0.92)
    g.fillRoundedRect(QUESTION_PANEL_X, QUESTION_PANEL_Y, QUESTION_PANEL_W, QUESTION_PANEL_H, 10)
    g.lineStyle(2, 0x334155, 1)
    g.strokeRoundedRect(QUESTION_PANEL_X, QUESTION_PANEL_Y, QUESTION_PANEL_W, QUESTION_PANEL_H, 10)
  }

  _updateScoreText() {
    this.scoreValue.setText(String(Math.max(this.score, 0)))
  }

  _updateQuestionCounter() {
    if (!this.questionCounterValue) return
    const answered = this.qd ? this.qd.getProgress().answered : 0
    this.questionCounterValue.setText(String(answered + 1))
  }

  // ---------- Input ----------

  _setupInput() {
    if (this.autoPlay) return

    this.input.keyboard.on('keydown', (ev) => {
      if (this.ended || this._isPaused) return
      const key = ev.key
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') this._changeLane(this.currentLane - 1)
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') this._changeLane(this.currentLane + 1)
      else if (key === 'ArrowUp' || key === 'w' || key === 'W') this._commitToLane()
    })

    this._pointerStart = null
    this.input.on('pointerdown', (p) => {
      if (this.ended || this._isPaused) return
      // Dead-zone around the pause button so tapping it doesn't also enqueue
      // a lane change on pointerup.
      const padX = PAUSE_X + PAUSE_SIZE + 12
      const padY = PAUSE_Y + PAUSE_SIZE + 12
      if (p.x < padX && p.y < padY) {
        this._pointerStart = null
        return
      }
      this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
    })
    this.input.on('pointerup', (p) => {
      if (this.ended || this._isPaused || !this._pointerStart) { this._pointerStart = null; return }
      const dx = p.x - this._pointerStart.x
      const dy = p.y - this._pointerStart.y
      const dt = Date.now() - this._pointerStart.t
      const SWIPE_THRESHOLD = 40
      const TAP_MAX_MOVE = 12
      const TAP_MAX_TIME = 300

      if (Math.abs(dx) < TAP_MAX_MOVE && Math.abs(dy) < TAP_MAX_MOVE && dt < TAP_MAX_TIME) {
        this._handleTap(p.x)
      } else if (Math.abs(dy) > Math.abs(dx) && dy < -SWIPE_THRESHOLD) {
        this._commitToLane()
      } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        this._changeLane(this.currentLane + (dx > 0 ? 1 : -1))
      }
      this._pointerStart = null
    })
  }

  _handleTap(x) {
    if (x < GAME_W / 2) this._changeLane(this.currentLane - 1)
    else this._changeLane(this.currentLane + 1)
  }

  _changeLane(toLane) {
    const clamped = Phaser.Math.Clamp(toLane, 0, LANE_COUNT - 1)
    if (clamped === this.currentLane) return
    this.currentLane = clamped
    const targetX = laneCenterAtY(this.currentLane, RUNNER_Y)
    this.runnerTargetX = targetX
    if (this.runnerLaneTween) this.runnerLaneTween.stop()
    this.runnerLaneTween = this.tweens.add({
      targets: this.runner,
      x: targetX,
      duration: LANE_CHANGE_MS,
      ease: 'Sine.easeOut',
    })
  }

  // ---------- Level lifecycle ----------

  _startLevel() {
    // Infinite mode: dispatcher owns the queue forever. The only exit is
    // score <= 0 or the user quitting via the pause overlay.
    this._loadNextQuestion()
  }

  _loadNextQuestion() {
    let q = this.qd.current()
    if (!q) {
      // Dispatcher should never run dry — it auto-reshuffles — but if
      // something unexpected happens, recycle from question 0 instead of
      // ending the game. Score is the ONLY failure condition.
      this.qd.shuffleRemaining()
      q = this.qd.current()
      if (!q) return
    }
    this.pendingQuestion = q
    this._updateQuestionCounter()

    // Shuffle the letter→option mapping here (instead of in _spawnGateGroup)
    // so the answer grid and the gate lineup agree.
    const laneToOptionIdx = [0, 1, 2, 3]
    for (let i = laneToOptionIdx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[laneToOptionIdx[i], laneToOptionIdx[j]] = [laneToOptionIdx[j], laneToOptionIdx[i]]
    }
    this.pendingLaneToOptionIdx = laneToOptionIdx

    destroyAnswerGrid(this._gridHandles)
    this._gridHandles = renderAnswerGrid(this, {
      x: 0,
      y: GRID_BANNER_TOP,
      width: GAME_W,
      question: q.q,
      options: laneToOptionIdx.map((idx) => (q.options ? q.options[idx] : '')),
      correctIndex: laneToOptionIdx.indexOf(q.answer_index),
      depth: D_HUD,
      ...GRID_OPTS,
    })

    // Difficulty-tied slowdown: hard questions get 15% more time.
    const tier = this.qd.getDifficultyTier()
    const mult = tier === 'hard' ? HARD_Q_SLOWDOWN : 1
    this.transitSeconds = Math.min(BASE_TRANSIT_S * HARD_Q_SLOWDOWN, this.baseTransitS * mult)

    this._beginReadingPause(() => this._spawnGateGroup(q))
  }

  _beginReadingPause(onEnd) {
    // The 3-2-1 countdown runs ONCE per session, right before the first
    // question. Every subsequent call just fires onEnd immediately so
    // gameplay flows between questions without freezing.
    if (this._didInitialCountdown || this.autoPlay) {
      this._readingActive = false
      return onEnd && onEnd()
    }
    this._didInitialCountdown = true
    this._readingActive = true

    const cx = GAME_W / 2
    const cy = Y_HORIZON + 80
    if (this._countdownText) this._countdownText.destroy()
    this._countdownText = this.add.text(cx, cy, '3', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '96px',
      color: '#38bdf8', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(D_COUNTDOWN)

    const step = READING_PAUSE_MS / 3
    this.time.delayedCall(step, () => {
      if (this._countdownText) this._countdownText.setText('2')
    })
    this.time.delayedCall(step * 2, () => {
      if (this._countdownText) this._countdownText.setText('1')
    })
    this.time.delayedCall(READING_PAUSE_MS, () => {
      if (this._countdownText) { this._countdownText.destroy(); this._countdownText = null }
      this._readingActive = false
      if (!this.ended) onEnd && onEnd()
      this._showCommitHint()
    })
  }

  _showCommitHint() {
    if (this._hintShown || this.autoPlay || this.ended) return
    try {
      if (typeof localStorage !== 'undefined'
          && localStorage.getItem('gp_hint_laneRunner_commit') === 'true') {
        this._hintShown = true
        return
      }
    } catch { /* storage blocked — show hint anyway */ }

    this._hintShown = true
    try { localStorage.setItem('gp_hint_laneRunner_commit', 'true') } catch { /* ignore */ }

    const cx = GAME_W / 2
    const cy = Math.floor(GAME_H * 0.7)
    const panelW = 380
    const panelH = 56
    const x0 = cx - panelW / 2
    const y0 = cy - panelH / 2

    const panel = this.add.graphics().setDepth(D_COUNTDOWN + 10)
    panel.fillStyle(0x0f172a, 0.9)
    panel.fillRoundedRect(x0, y0, panelW, panelH, 12)
    panel.lineStyle(1.5, 0x38bdf8, 0.8)
    panel.strokeRoundedRect(x0, y0, panelW, panelH, 12)

    const arrow = this.add.graphics().setDepth(D_COUNTDOWN + 11)
    arrow.fillStyle(0x38bdf8, 1)
    const ax = x0 + 24
    arrow.fillTriangle(ax, cy - 8, ax - 7, cy + 6, ax + 7, cy + 6)

    const label = this.add.text(
      cx + 10,
      cy,
      'Swipe up or press Up to commit faster',
      {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '15px',
        color: '#f8fafc',
        fontStyle: 'bold',
      },
    ).setOrigin(0.5).setDepth(D_COUNTDOWN + 11)

    const elements = [panel, arrow, label]

    // Subtle pulse: alpha 0.7 ↔ 1.0, repeated ~3 cycles inside the 4s window.
    const pulse = this.tweens.add({
      targets: elements,
      alpha: { from: 1, to: 0.7 },
      duration: 600,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
    })

    this.time.delayedCall(4000, () => {
      if (pulse && pulse.isPlaying()) pulse.stop()
      this.tweens.add({
        targets: elements,
        alpha: 0,
        duration: 350,
        onComplete: () => {
          for (const el of elements) {
            try { el.destroy() } catch { /* already gone */ }
          }
        },
      })
    })
  }

  _spawnGateGroup(q) {
    if (this.ended || !q) return
    // Shuffle was done in _loadNextQuestion so the grid display matches
    // the gate letters. Reuse the stored mapping.
    const laneToOptionIdx = this.pendingLaneToOptionIdx || [0, 1, 2, 3]

    const group = {
      progress: 0,
      question: q,
      resolving: false,
      visuals: [],
      laneToOptionIdx,
    }
    for (let i = 0; i < LANE_COUNT; i++) {
      const color = GATE_COLORS[i]
      const bg = this.add.graphics().setDepth(D_GATE_BG)
      const label = this.add.text(0, 0, LETTERS[i], {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '56px',
        color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5, 0.5).setDepth(D_GATE_LABEL)
      group.visuals.push({ lane: i, optionIdx: laneToOptionIdx[i], color, bg, label })
    }
    this.activeGates = group
  }

  // ---------- Render loop ----------

  update(_, delta) {
    if (this.ended || this._isPaused) return
    const dt = delta / 1000

    this._renderRoad(dt)
    this._updateGates(dt)
    this._renderGates()
  }

  _renderRoad(dt) {
    if (!this._readingActive) {
      this.scrollOffset += dt * ROAD_SCROLL_RATE
    }
    const g = this.roadGraphics
    g.clear()

    const stripH = ROAD_H / STRIP_COUNT

    // Asphalt strips (alternating)
    const offsetInt = Math.floor(this.scrollOffset)
    for (let i = 0; i < STRIP_COUNT; i++) {
      const yTop = Y_HORIZON + i * stripH
      const tMid = (i + 0.5) / STRIP_COUNT
      const halfW = HALF_AT_HORIZON + (HALF_AT_BOTTOM - HALF_AT_HORIZON) * tMid
      const color = (i + offsetInt) % 2 === 0 ? COLOR_ASPHALT_A : COLOR_ASPHALT_B
      g.fillStyle(color, 1)
      g.fillRect(CX - halfW, yTop, halfW * 2, stripH + 1)
    }

    // White edges (constant pixel width but scaled slightly with perspective)
    for (let i = 0; i < STRIP_COUNT; i++) {
      const yTop = Y_HORIZON + i * stripH
      const tMid = (i + 0.5) / STRIP_COUNT
      const halfW = HALF_AT_HORIZON + (HALF_AT_BOTTOM - HALF_AT_HORIZON) * tMid
      const edgeW = 3 + 6 * tMid
      g.fillStyle(COLOR_EDGE, 1)
      g.fillRect(CX - halfW - edgeW, yTop, edgeW, stripH + 1)
      g.fillRect(CX + halfW, yTop, edgeW, stripH + 1)
    }

    // Yellow lane dividers: dashed, every other strip shifted by scroll
    for (let i = 0; i < STRIP_COUNT; i++) {
      if ((i + offsetInt) % 2 !== 0) continue
      const yTop = Y_HORIZON + i * stripH
      const tMid = (i + 0.5) / STRIP_COUNT
      const halfW = HALF_AT_HORIZON + (HALF_AT_BOTTOM - HALF_AT_HORIZON) * tMid
      const laneW = (halfW * 2) / LANE_COUNT
      const dashW = 2 + 4 * tMid
      g.fillStyle(COLOR_DIVIDER, 1)
      for (const d of [-1, 0, 1]) {
        const dx = CX + d * laneW
        g.fillRect(dx - dashW / 2, yTop, dashW, stripH + 1)
      }
    }
  }

  _updateGates(dt) {
    if (!this.activeGates || this.activeGates.resolving) return
    if (this._readingActive) return
    // While a commit rush-in tween is driving progress directly, skip the
    // natural dt-based advance so the two don't compound.
    if (this._committing) return
    this.activeGates.progress += dt / this.transitSeconds
    if (this.activeGates.progress >= 1) {
      this.activeGates.progress = 1
      this._resolveGates()
    }
  }

  _commitToLane() {
    if (this.ended || this._isPaused) return
    if (this._readingActive || this._committing) return
    if (!this.activeGates || this.activeGates.resolving) return

    this._committing = true
    const group = this.activeGates

    // Runner lunges forward: brief lean + tiny forward hop.
    if (this.runner) {
      this.tweens.add({
        targets: this.runner,
        angle: -10,
        duration: 100,
        yoyo: true,
        ease: 'Sine.easeOut',
      })
    }

    // Rush the approaching gate toward the runner over ~200ms. _updateGates
    // is gated by _committing, so only this tween drives progress.
    this.tweens.add({
      targets: group,
      progress: 1,
      duration: 200,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this._committing = false
        if (this.ended) return
        if (this.activeGates !== group) return
        this._resolveGates()
      },
    })
  }

  _renderGates() {
    if (!this.activeGates || this.activeGates.resolving) return
    const progress = this.activeGates.progress
    for (const v of this.activeGates.visuals) {
      const y = Y_HORIZON + (RUNNER_Y - Y_HORIZON) * progress
      const halfW = halfWidthAtY(y)
      const laneW = (halfW * 2) / LANE_COUNT
      const x = CX + (v.lane - (LANE_COUNT - 1) / 2) * laneW
      const gateW = laneW * 0.88
      const gateH = 28 + 48 * progress
      v.bg.clear()
      v.bg.fillStyle(v.color, 0.88)
      v.bg.fillRoundedRect(x - gateW / 2, y - gateH, gateW, gateH, 6)
      v.bg.lineStyle(2, 0xffffff, 0.85)
      v.bg.strokeRoundedRect(x - gateW / 2, y - gateH, gateW, gateH, 6)
      v.label.setPosition(x, y - gateH / 2)
      // Scale letter from ~0.35 at horizon to ~1.0 at camera (56px → 20–56px)
      v.label.setScale(0.35 + 0.65 * progress)
    }
  }

  // ---------- Resolution ----------

  _resolveGates() {
    const group = this.activeGates
    group.resolving = true
    const q = group.question
    const chosenLane = this.currentLane
    const chosenOptionIdx = group.laneToOptionIdx[chosenLane]
    // Lane index that holds the correct option (after shuffle).
    const correctLane = group.laneToOptionIdx.indexOf(q.answer_index)

    const result = this.qd.submitAnswer(chosenOptionIdx)
    const isCorrect = result.correct

    if (isCorrect) {
      this.score += SCORE_CORRECT
      // Adaptive speed: each correct answer shortens transit by 4% (floor MIN).
      // Wrong answers leave speed untouched.
      const nextBase = Math.max(MIN_TRANSIT_S, this.baseTransitS * SPEED_BUMP_FACTOR)
      if (nextBase < this.baseTransitS) {
        this.baseTransitS = nextBase
        this._banner('Speeding up!', '#10b981')
      }
    } else {
      this.score = Math.max(0, this.score + SCORE_WRONG)
    }
    this._updateScoreText()

    // Freeze gates at their current visual positions. Flash correct/chosen.
    const finalTweens = []
    for (const v of group.visuals) {
      let flashColor = null
      if (v.lane === correctLane) flashColor = 0x22c55e
      else if (!isCorrect && v.lane === chosenLane) flashColor = 0xef4444

      if (flashColor) {
        // Redraw with flash color at current visual position
        const y = Y_HORIZON + (RUNNER_Y - Y_HORIZON) * group.progress
        const halfW = halfWidthAtY(y)
        const laneW = (halfW * 2) / LANE_COUNT
        const x = CX + (v.lane - (LANE_COUNT - 1) / 2) * laneW
        const gateW = laneW * 0.88
        const gateH = 28 + 48 * group.progress
        v.bg.clear()
        v.bg.fillStyle(flashColor, 1)
        v.bg.fillRoundedRect(x - gateW / 2, y - gateH, gateW, gateH, 6)
        v.bg.lineStyle(3, 0xffffff, 1)
        v.bg.strokeRoundedRect(x - gateW / 2, y - gateH, gateW, gateH, 6)
        // Small pulse
        finalTweens.push(this.tweens.add({
          targets: [v.bg, v.label],
          alpha: 0,
          duration: 500,
          delay: 300,
        }))
      } else {
        finalTweens.push(this.tweens.add({
          targets: [v.bg, v.label],
          alpha: 0,
          duration: 300,
        }))
      }
    }

    this._flashCamera(isCorrect ? 0x22c55e : 0xef4444)
    this._banner(
      isCorrect ? `+${SCORE_CORRECT}` : `${SCORE_WRONG}`,
      isCorrect ? '#10b981' : '#ef4444',
      900,
    )

    // After the flash: tear down, then either game over or next question
    this.time.delayedCall(850, () => {
      for (const v of group.visuals) {
        v.bg.destroy()
        v.label.destroy()
      }
      this.activeGates = null
      if (this.score <= 0) {
        return this._endSession()
      }
      this.qd.advance()
      this._saveSnapshot()
      this._loadNextQuestion()
    })
  }

  _flashCamera(color) {
    if (this.autoPlay) return
    this.cameras.main.flash(160, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1200) {
    const t = this.add.text(GAME_W / 2, GRID_BANNER_TOP + GRID_OPTS.questionHeight + 14, text, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '22px', color,
      backgroundColor: '#0f172a', padding: { x: 16, y: 6 }, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(D_COUNTDOWN)
    this.tweens.add({
      targets: t, alpha: 0, y: GRID_BANNER_TOP + GRID_OPTS.questionHeight - 4, duration, delay: 150,
      onComplete: () => t.destroy(),
    })
  }

  // ---------- Endgame ----------

  _endSession() {
    if (this.ended) return
    if (this.autoPlay) return this._resetAndRestart()
    this._showGameOver()
  }

  _showGameOver() {
    this.ended = true
    this._clearActiveGates()
    if (this._gameId) { try { clearGameState(this._gameId) } catch { /* ignore */ } }

    const cx = GAME_W / 2
    const cy = GAME_H / 2
    this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x0c1220, 0.9).setDepth(500)
    this.add.text(cx, cy - 180, 'Run over', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '40px',
      color: '#f1f5f9', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(501)

    const prog = this.qd.getProgress()
    const elapsed = this._effectiveTimeSeconds()
    const pct = prog.answered > 0 ? Math.round((prog.correct / prog.answered) * 100) : 0
    this.add.text(cx, cy - 40, [
      `You reached question ${prog.answered}`,
      `Score: ${this.score}`,
      `Correct: ${prog.correct}/${prog.answered} (${pct}%)`,
      `Time: ${elapsed}s`,
      `Attempt ${this.attemptNumber}`,
    ].join('\n'), {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '20px',
      color: '#e2e8f0', align: 'center',
    }).setOrigin(0.5).setDepth(501)

    this._makeButton(cx, cy + 120, 'Play again', 0x0ea5e9, () => this._resetAndRestart())
    this._makeButton(cx, cy + 190, 'Back to picker', 0x334155, () => this._goBackToPicker())

    this.input.keyboard.once('keydown-ENTER', () => this._resetAndRestart())
  }

  _makeButton(x, y, label, fillColor, onClick) {
    const w = 220, h = 50, r = 10
    const x0 = x - w / 2, y0 = y - h / 2
    const g = this.add.graphics().setDepth(501)
    const draw = (alpha) => {
      g.clear()
      g.fillStyle(fillColor, alpha)
      g.fillRoundedRect(x0, y0, w, h, r)
    }
    draw(1)
    this.add.text(x, y, label, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
      color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(502)
    g.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(x0, y0, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    g.on('pointerover', () => draw(0.8))
    g.on('pointerout', () => draw(1))
    g.on('pointerdown', onClick)
    return g
  }

  _clearActiveGates() {
    if (!this.activeGates) return
    for (const v of this.activeGates.visuals) {
      try { v.bg.destroy() } catch { /* ignore */ }
      try { v.label.destroy() } catch { /* ignore */ }
    }
    this.activeGates = null
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
    this.ended = true
    const prog = this.qd.getProgress()
    this.onSessionEnd({
      score: this.score,
      hearts: Math.max(0, this.score),
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
      x: PAUSE_X + PAUSE_SIZE / 2,
      y: PAUSE_Y + PAUSE_SIZE / 2,
      onClick: () => this._togglePause(),
      depth: D_HUD + 2,
    })
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
    // Phaser's input manager can be left disabled by tab-blur auto-pause;
    // force-enable so overlay buttons respond when the user returns.
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
      hearts: Math.max(0, this.score),
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
}
