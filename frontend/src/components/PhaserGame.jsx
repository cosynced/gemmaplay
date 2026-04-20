import { useEffect, useRef } from 'react'
import Phaser from '../scenes/phaser-global.js'
import { BootScene } from '../scenes/BootScene.js'
import { GameScene } from '../scenes/GameScene.js'
import { LaneRunnerScene } from '../scenes/LaneRunnerScene.js'
import { TetrisAnswerScene } from '../scenes/TetrisAnswerScene.js'
import { ShooterAnswerScene } from '../scenes/ShooterAnswerScene.js'
import { SnakeKnowledgeScene } from '../scenes/SnakeKnowledgeScene.js'

export function PhaserGame({ game, lesson, sessionId, onSessionEnd }) {
  const containerRef = useRef(null)
  const gameRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return

    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 960,
      height: 540,
      backgroundColor: '#0c1220',
      physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: false },
      },
      // All scenes are registered; BootScene picks which one to start based
      // on game.game_type. Order is intentional — BootScene is the entry point.
      scene: [
        BootScene,
        LaneRunnerScene,
        TetrisAnswerScene,
        ShooterAnswerScene,
        SnakeKnowledgeScene,
        GameScene,
      ],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    }

    const phaser = new Phaser.Game(config)
    phaser.scene.start('BootScene', { game, lesson, sessionId, onSessionEnd })
    gameRef.current = phaser

    // Re-fit the canvas whenever the container resizes. Phaser's Scale.FIT
    // only recomputes on window resize by default; the wrapper here uses
    // viewport-relative sizing, so a DevTools resize or orientation change
    // could leave the canvas stale without this.
    const ro = new ResizeObserver(() => {
      if (gameRef.current) gameRef.current.scale.refresh()
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      phaser.destroy(true)
      gameRef.current = null
    }
  }, [game, lesson, sessionId, onSessionEnd])

  // w-full/h-full makes the host div fill its parent so Phaser's FIT mode
  // reads a non-zero bounding rect. Without this, the div collapses to
  // auto-height and the canvas ends up at its native pixel size.
  return (
    <div
      ref={containerRef}
      className="phaser-container w-full h-full flex items-center justify-center"
    />
  )
}
