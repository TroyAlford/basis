/* eslint-disable no-console */
if (typeof window !== 'undefined') {
  const connectWebSocket = () => {
    const ws = new WebSocket(`ws://${window.location.host}`)

    ws.onmessage = async event => {
      const data = JSON.parse(event.data)

      if (data.type === 'hmr') {
        console.log('[HMR] Updating modules...')

        // Clear module cache and reload once
        const moduleCache = Object.keys(window)
          .filter(k => k.startsWith('__bun_'))
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        moduleCache.forEach(key => delete window[key])
        window.location.reload()
      }
    }

    ws.onopen = () => {
      console.log('[HMR] Connected to development server')
    }

    ws.onclose = () => {
      console.log('[HMR] Connection closed, attempting to reconnect...')
      // Try to reconnect after a short delay
      setTimeout(connectWebSocket, 1000)
    }

    ws.onerror = error => {
      console.error('[HMR] WebSocket error:', error)
    }

    return ws
  }

  connectWebSocket()
}
