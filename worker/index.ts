interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
}

const API_PREFIX = '/api/'
const API_PROXIES: Record<string, { origin: string, strip: string }> = {
  '/api/crowd/': { origin: 'https://crowd-api.sfc.sz7.jp', strip: '/api/crowd' },
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) {
      return env.ASSETS.fetch(request)
    }
    const prefix = Object.keys(API_PROXIES).find((key) => url.pathname.startsWith(key))
    if (!prefix) return new Response('Not Found', { status: 404 })
    const { origin, strip } = API_PROXIES[prefix]
    const target = new URL(url.pathname.slice(strip.length) + url.search, origin)
    return fetch(target, { method: request.method, headers: request.headers })
  },
}
