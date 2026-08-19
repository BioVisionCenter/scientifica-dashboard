import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { api } from './client'
import type { Entry, RevealPayload, Scene } from './types'

/** Reconnecting websocket that dispatches messages into the app store. */
export function useWebsocket(role: 'tv' | 'admin') {
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry = 500

    const store = useAppStore.getState

    const resync = async () => {
      try {
        const [scene, entries, exploreState] = await Promise.all([
          api.getScene(),
          api.entries(20),
          api.exploreState(),
        ])
        store().setScene(scene.scene, scene.payload)
        if (scene.lang) store().setLang(scene.lang)
        store().setEntries(entries)
        if (exploreState && Object.keys(exploreState).length) store().setExploreSync(exploreState)
      } catch {
        /* backend not up yet; the next reconnect retries */
      }
    }

    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws?role=${role}`)

      ws.onopen = () => {
        retry = 500
        store().setConnected(true)
        ws?.send(JSON.stringify({ type: 'hello', role }))
        void resync()
      }
      ws.onclose = () => {
        store().setConnected(false)
        if (!closed) {
          setTimeout(connect, retry)
          retry = Math.min(retry * 2, 8000)
        }
      }
      ws.onmessage = (event) => {
        const { type, payload } = JSON.parse(event.data)
        const s = store()
        switch (type) {
          case 'scene:set':
            s.setScene(payload.scene as Scene, payload.payload ?? {})
            break
          case 'lang:set':
            s.setLang(payload.lang)
            break
          case 'leaderboard:update':
            s.setEntries(payload.entries as Entry[])
            break
          case 'entry:reveal':
            // the reveal must always be seen: hop to the leaderboard scene first
            if (useAppStore.getState().scene !== 'leaderboard') s.setScene('leaderboard')
            s.setReveal(payload as RevealPayload)
            break
          case 'explore:sync':
            s.setExploreSync(payload)
            break
          case 'job:progress':
            s.setJobStage({ jobId: payload.job_id, stage: payload.stage })
            break
          case 'job:done':
          case 'job:error':
            s.setJobStage(null)
            break
        }
      }
    }

    connect()
    return () => {
      closed = true
      ws?.close()
    }
  }, [role])
}
