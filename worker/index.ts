interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
}

const API_PREFIX = '/api'
const API_ORIGIN = 'http://localhost:3000'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      return env.ASSETS.fetch(request)
    }
    const origin = url.pathname.startsWith('/api/wifi/') ? 'https://api.dtc.wide.ad.jp' : API_ORIGIN
    const target = new URL(url.pathname.slice(API_PREFIX.length) + url.search, origin)
    return fetch(target, { method: request.method, headers: request.headers })
  },
}
