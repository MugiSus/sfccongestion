import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { buildAccessPointHierarchy, layoutAccessPoints, type WifiSnapshot } from './treemap'

const WIFI_URL = '/api/wifi/clients/list'
const REFRESH_MS = 5 * 60 * 1000
const TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

export default function App() {
  const [snapshot, setSnapshot] = createSignal<WifiSnapshot | null>(null)
  const [error, setError] = createSignal(false)
  const [viewport, setViewport] = createSignal({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  const layout = createMemo(() => {
    const root = buildAccessPointHierarchy(snapshot()?.clients ?? [])
    const { width, height } = viewport()
    return layoutAccessPoints.size([width, height])(root).descendants().slice(1)
  })
  const nodeIds = createMemo(() => layout().map((node) => node.data.id))
  const nodes = createMemo(() => new Map(layout().map((node) => [node.data.id, node])))
  const maximum = createMemo(() => Math.max(1, ...layout().map((node) => node.data.clients)))

  onMount(() => {
    const handleResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', handleResize)
    const controller = new AbortController()
    let loading = false

    const load = async () => {
      if (loading) return
      loading = true
      try {
        const response = await fetch(WIFI_URL, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`Wi-Fi API: ${response.status}`)
        const next = await response.json() as WifiSnapshot
        if (controller.signal.aborted) return
        setSnapshot(next)
        setError(false)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        loading = false
      }
    }

    void load()
    const refreshTimer = window.setInterval(() => void load(), REFRESH_MS)
    onCleanup(() => {
      controller.abort()
      window.clearInterval(refreshTimer)
      window.removeEventListener('resize', handleResize)
    })
  })

  return (
    <main class="fixed inset-0 overflow-hidden bg-[#0a0c0f] text-white" aria-label="棟・階・AP別のWi-Fi接続端末数">
      <For each={nodeIds()}>
        {(id) => {
          const node = () => nodes().get(id)!
          const isAp = () => node().data.kind === 'ap'
          const width = () => node().x1 - node().x0
          const height = () => node().y1 - node().y0
          const name = () => {
            const data = node().data
            if (data.kind !== 'building') return data.name
            return data.name === 'unknown' ? '棟不明' : data.name.charAt(0).toUpperCase() + data.name.slice(1)
          }
          const title = () => `${node().ancestors().reverse().slice(1).map((part) => part.data.name).join(' / ')} · ${node().value}`
          const fontSize = () => Math.max(8, Math.min(
            32, Math.sqrt(width() * height()) * 0.15,
            (width() - 8) / (name().length * 0.6), (height() - 8) / 2.5,
          ))

          return (
            <div
              class="cell-transition absolute overflow-hidden rounded-[4px]"
              classList={{ 'flex items-center justify-center': isAp() }}
              title={title()}
              role={isAp() ? 'img' : undefined}
              aria-label={isAp() ? title() : undefined}
              style={{
                left: `${node().x0}px`, top: `${node().y0}px`,
                width: `${width()}px`, height: `${height()}px`,
                'background-color': isAp()
                  ? `hsl(${130 * (1 - node().data.clients / maximum())} 68% 41%)`
                  : node().depth === 1 ? '#1d232b' : '#303741',
              }}
            >
              <Show when={isAp()} fallback={
                <Show when={width() >= 40 && height() >= 48}>
                  <div class="truncate px-1 text-xs leading-4 font-semibold">
                    {name()} · {node().value}
                  </div>
                </Show>
              }>
                <Show when={width() >= 24 && height() >= 24}>
                  <div class="w-full overflow-hidden px-1 text-center leading-[1.15] [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]" style={{ 'font-size': `${fontSize()}px` }}>
                    <div class="truncate font-semibold">{name()}</div>
                    <div class="tabular-nums opacity-85">{node().data.clients}</div>
                  </div>
                </Show>
              </Show>
            </div>
          )
        }}
      </For>
      <Show when={!snapshot() || snapshot()?.clients.length === 0}>
        <p class="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground" role="status">
          {error() ? 'Wi-Fi接続情報を取得できませんでした。' : snapshot() ? '接続中の端末はありません。' : 'Wi-Fi接続情報を読み込み中…'}
        </p>
      </Show>
      <Show when={snapshot()}>
        {(value) => (
          <div class="pointer-events-none fixed right-2 bottom-2 rounded bg-background/85 px-2 py-1 text-xs text-foreground" role="status">
            {TIME_FORMATTER.format(new Date(value().measuredAt))} · {value().clients.length}
            {error() ? ' · 更新に失敗（前回の観測を表示）' : ''}
          </div>
        )}
      </Show>
    </main>
  )
}
