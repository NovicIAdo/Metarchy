// React host for the Pixi board. Owns the Application lifecycle (StrictMode-safe:
// init is async, so both the pre-init and post-init paths must handle unmount),
// feeds derived BoardProps into the scene, and exposes hit-testing for DOM drags.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { LocationId } from '@metarchy/engine'
import { Application } from 'pixi.js'
import { BoardScene, loadBoardTextures, type BoardProps } from './scene.js'

export interface PixiBoardHandle {
  hitTestLocation(clientX: number, clientY: number): LocationId | null
  /** Viewport center of a location — anchors DOM overlays to board geometry. */
  locationToScreen(id: LocationId): { x: number; y: number } | null
  /** Fullscreen modals cover the board — stop burning frames underneath them. */
  setRenderPaused(paused: boolean): void
}

export interface PixiBoardProps {
  board: BoardProps
  onLocationTap(id: LocationId): void
  onLocationHover(id: LocationId | null): void
  onTokenTap(id: string): void
}

export const PixiBoard = forwardRef<PixiBoardHandle, PixiBoardProps>(
  function PixiBoard(props, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const sceneRef = useRef<BoardScene | null>(null)
    const pausedRef = useRef(false)
    const latest = useRef(props)
    latest.current = props
    const [ready, setReady] = useState(false)

    useEffect(() => {
      const host = hostRef.current
      if (!host) return
      let cancelled = false
      let app: Application | null = null
      let scene: BoardScene | null = null

      void (async () => {
        const [textures, created] = await Promise.all([
          loadBoardTextures(),
          (async () => {
            const a = new Application()
            await a.init({
              backgroundAlpha: 0,
              antialias: true,
              resolution: Math.min(window.devicePixelRatio || 1, 2),
              autoDensity: true,
              resizeTo: host
            })
            // The scene stops the ticker whenever nothing animates (drawn on
            // demand); while something does, 30fps is plenty for a pulse.
            a.ticker.maxFPS = 30
            return a
          })()
        ])
        if (cancelled) {
          created.destroy(true)
          return
        }
        app = created
        host.appendChild(app.canvas)
        scene = new BoardScene(app, textures, {
          onLocationTap: (id) => latest.current.onLocationTap(id),
          onLocationHover: (id) => latest.current.onLocationHover(id),
          onTokenTap: (id) => latest.current.onTokenTap(id)
        })
        scene.setPaused(pausedRef.current)
        scene.update(latest.current.board)
        sceneRef.current = scene
        setReady(true)
      })()

      return () => {
        cancelled = true
        sceneRef.current = null
        scene?.destroy()
        app?.destroy(true)
        setReady(false)
      }
    }, [])

    useEffect(() => {
      sceneRef.current?.update(props.board)
    }, [props.board, ready])

    useImperativeHandle(
      ref,
      () => ({
        hitTestLocation: (x, y) => sceneRef.current?.hitTestLocation(x, y) ?? null,
        locationToScreen: (id) => sceneRef.current?.locationScreenCenter(id) ?? null,
        setRenderPaused: (paused) => {
          pausedRef.current = paused
          sceneRef.current?.setPaused(paused)
        }
      }),
      []
    )

    return (
      <div ref={hostRef} className="board-host">
        {!ready && <div className="board-loading">Loading board…</div>}
      </div>
    )
  }
)
