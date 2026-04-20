// PauseOverlay
//
// Shared visual layer for the in-game pause screen. Each scene calls
// `createPauseOverlay(this)` once in create() and then drives it via
// show / hide. The overlay renders its own "Resume" and "Quit to picker"
// buttons and owns the Enter-to-resume keyboard shortcut while visible.
//
// `addHudPauseButton(scene, opts)` is a tiny helper for the top-right
// pause pill that lives inside each scene's HUD. It's in this module too
// so the icon + touch target are identical across all four games.

const PAUSE_DEPTH = 9999
const PAUSE_PANEL_ALPHA = 0.88

function makeOverlayButton(scene, { x, y, label, fillColor, onClick }) {
  const w = 200
  const h = 48
  const r = 10
  const x0 = -w / 2
  const y0 = -h / 2
  const g = scene.add.graphics()
  const redraw = (alpha) => {
    g.clear()
    g.fillStyle(fillColor, alpha)
    g.fillRoundedRect(x0, y0, w, h, r)
  }
  redraw(1)
  const text = scene.add.text(0, 0, label, {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '16px',
    color: '#ffffff',
    fontStyle: 'bold',
  }).setOrigin(0.5)
  const container = scene.add.container(x, y, [g, text])
  container.setSize(w, h)
  container.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(x0, y0, w, h),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  })
  container.on('pointerover', () => redraw(0.85))
  container.on('pointerout', () => redraw(1))
  container.on('pointerdown', onClick)
  return container
}

/**
 * Creates the dimmed-canvas pause overlay for a scene. Returns a handle
 * with `show`, `hide`, `isShowing`, and `destroy`. Safe to call `hide`
 * when already hidden (no-op). The Enter key resumes while the overlay
 * is visible and the listener is removed on hide.
 */
export function createPauseOverlay(scene) {
  let visible = false
  let elements = []
  let buttons = []
  let enterHandler = null

  function show({ onResume, onQuit }) {
    if (visible) return
    visible = true
    const gs = scene.scale.gameSize
    const width = gs.width
    const height = gs.height

    // When the overlay is shown from a visibilitychange auto-pause, Phaser's
    // input plugin can be left disabled by the blur/focus cycle. Re-assert
    // it before building interactive buttons so clicks land on the overlay.
    if (scene.input) scene.input.enabled = true
    if (scene.input?.keyboard) scene.input.keyboard.enabled = true

    const panel = scene.add
      .rectangle(width / 2, height / 2, width, height, 0x0c1220, PAUSE_PANEL_ALPHA)
      .setDepth(PAUSE_DEPTH)

    const title = scene.add.text(width / 2, height / 2 - 70, 'Paused', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '44px',
      color: '#f1f5f9',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(PAUSE_DEPTH + 1)

    const resumeBtn = makeOverlayButton(scene, {
      x: width / 2,
      y: height / 2 + 10,
      label: 'Resume',
      fillColor: 0x0ea5e9,
      onClick: () => {
        console.log('[PauseOverlay] Resume clicked')
        onResume()
      },
    })
    resumeBtn.setDepth(PAUSE_DEPTH + 1)

    const quitBtn = makeOverlayButton(scene, {
      x: width / 2,
      y: height / 2 + 70,
      label: 'Quit to picker',
      fillColor: 0x334155,
      onClick: () => {
        console.log('[PauseOverlay] Quit clicked')
        onQuit()
      },
    })
    quitBtn.setDepth(PAUSE_DEPTH + 1)

    buttons = [resumeBtn, quitBtn]
    elements = [panel, title, resumeBtn, quitBtn]

    enterHandler = () => onResume()
    scene.input.keyboard?.on('keydown-ENTER', enterHandler)
  }

  function hide() {
    if (!visible) return
    visible = false
    if (enterHandler) {
      scene.input.keyboard?.off('keydown-ENTER', enterHandler)
      enterHandler = null
    }
    for (const btn of buttons) {
      try { btn.disableInteractive() } catch { /* already gone */ }
    }
    buttons = []
    const toDestroy = elements
    elements = []
    for (const el of toDestroy) {
      try { el.destroy() } catch { /* scene already torn down */ }
    }
  }

  function isShowing() {
    return visible
  }

  function destroy() {
    if (enterHandler) {
      scene.input.keyboard.off('keydown-ENTER', enterHandler)
      enterHandler = null
    }
    for (const el of elements) {
      try { el.destroy() } catch { /* already gone */ }
    }
    elements = []
    visible = false
  }

  return { show, hide, isShowing, destroy }
}

/**
 * Top-right pause pill. 38px visual square, 44px hit area so touch
 * targets meet the HIG minimum. Subtle scale-on-hover tween.
 */
export function addHudPauseButton(scene, { x, y, onClick, depth = 210 }) {
  const size = 38
  const hitSize = 44
  const g = scene.add.graphics()
  g.fillStyle(0x1e293b, 0.85)
  g.fillRoundedRect(-size / 2, -size / 2, size, size, 8)
  g.lineStyle(1.5, 0xffffff, 0.3)
  g.strokeRoundedRect(-size / 2, -size / 2, size, size, 8)
  g.fillStyle(0xe2e8f0, 1)
  g.fillRect(-7, -8, 4, 16)
  g.fillRect(3, -8, 4, 16)

  const container = scene.add.container(x, y, [g]).setDepth(depth)
  container.setSize(hitSize, hitSize)
  container.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-hitSize / 2, -hitSize / 2, hitSize, hitSize),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  })
  let hoverTween = null
  container.on('pointerover', () => {
    if (hoverTween) hoverTween.stop()
    hoverTween = scene.tweens.add({
      targets: container, scale: 1.1, duration: 120, ease: 'Sine.easeOut',
    })
  })
  container.on('pointerout', () => {
    if (hoverTween) hoverTween.stop()
    hoverTween = scene.tweens.add({
      targets: container, scale: 1, duration: 120, ease: 'Sine.easeOut',
    })
  })
  container.on('pointerdown', onClick)
  return container
}
