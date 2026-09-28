import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createQueries, createQuery } from '@tanstack/solid-query'
import CrowdTimeSlider from '@/components/crowd-time-slider'
import {
  CROWD_INTERVAL_MS, crowdQueryOptions, crowdRetryDelay, fetchBuildings,
  prioritizeCrowdRequests, retryCrowdRequest,
} from './crowd'
import {
  buildCrowdGrid, planCrowdRequests,
  type CrowdSample, type CrowdTarget,
} from './crowd-series'
import { squarify, type TreemapRect } from './treemap'

interface CellProps {
  target: CrowdTarget
  rect: () => TreemapRect<string> | undefined
  sample: () => CrowdSample | undefined
}

function displayName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
}

function utilizationColor(utilization: number | null | undefined): string {
  if (utilization == null) return 'hsl(215 10% 26%)'
  const ratio = Math.min(Math.max(utilization, 0), 1)
  return `hsl(${(1 - ratio) * 130} 68% 41%)`
}

function longestWord(value: string): string {
  let longest = ''
  for (const word of value.split(/\s+/)) {
    if (word.length > longest.length) longest = word
  }
  return longest
}

function textMetrics(rect: TreemapRect<string>, name: string, stats: string) {
  const width = rect.width - 12
  const height = rect.height - 12
  if (width <= 0 || height <= 0) return null
  const ideal = Math.sqrt(rect.width * rect.height) * 0.15
  const nameFit = width / (longestWord(name).length * 0.62)
  const nameSize = Math.max(Math.min(ideal, 64, nameFit, (height - 2) / 1.7825), 8)
  const statsSize =
    stats.length === 0
      ? 0
      : Math.max(
          Math.min(nameSize * 0.55, width / (stats.length * 0.62), (height - nameSize * 1.15 - 2) / 1.15),
          8,
        )
  return { nameSize, statsSize }
}

function Cell(props: CellProps) {
  const name = () => props.target.label
  const point = () => {
    const data = props.sample()?.data
    return data?.status === 'available' ? data.point : undefined
  }
  const stats = () => {
    const value = point()
    if (!value) return '–'
    const utilization = value.seatUtilization === null ? '–' : `${Math.round(value.seatUtilization * 100)}%`
    return `${utilization} · ${Math.round(value.estimatedPeople)}人`
  }

  const metrics = createMemo(() => {
    const rect = props.rect()
    if (!rect || rect.width < 12 || rect.height < 10) return null
    const value = textMetrics(rect, name(), stats())
    return value ? { rect, ...value } : null
  })

  const cellStyle = () => {
    const value = metrics()
    if (!value) return { display: 'none' }
    const { rect } = value
    return {
      display: 'flex',
      left: `${rect.x + 2}px`,
      top: `${rect.y + 2}px`,
      width: `${Math.max(rect.width - 4, 0)}px`,
      height: `${Math.max(rect.height - 4, 0)}px`,
      'background-color': utilizationColor(point()?.seatUtilization),
    }
  }

  return (
    <div
      aria-label={`${name()} ${stats()}`}
      class="cell-transition absolute flex items-center justify-center overflow-hidden rounded-[4px] p-1 text-white"
      style={cellStyle()}
    >
      <Show when={metrics()}>
        {(value) => (
          <div class="flex max-h-full w-full flex-col items-center justify-center gap-[0.15em] text-center leading-[1.15]">
            <span
              class="min-h-0 max-w-full overflow-hidden font-semibold tracking-[0.01em] [overflow-wrap:anywhere] [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]"
              style={{ 'font-size': `${value().nameSize}px` }}
            >
              {name()}
            </span>
            <Show when={stats()}>
              <span
                class="max-w-full flex-none overflow-hidden tabular-nums whitespace-nowrap opacity-85 [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]"
                style={{ 'font-size': `${value().statsSize}px` }}
              >
                {stats()}
              </span>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

export default function App() {
  const [nowMs, setNowMs] = createSignal(Date.now())
  const [selectedTime, setSelectedTime] = createSignal<number>()
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 })
  let mapElement!: HTMLDivElement

  const catalog = createQuery(() => ({
    queryKey: ['buildings'],
    queryFn: ({ signal }) => fetchBuildings(signal),
    staleTime: 60 * 60 * 1000,
    retry: retryCrowdRequest,
    retryDelay: crowdRetryDelay,
  }))
  const buildings = () => catalog.data ?? []
  const grid = createMemo(() => buildCrowdGrid(nowMs()))
  const timestamp = createMemo(() => Math.max(grid().startMs, Math.min(
    selectedTime() ?? Math.floor(nowMs() / CROWD_INTERVAL_MS) * CROWD_INTERVAL_MS,
    grid().endMs,
  )))
  // Keep a chosen absolute time fixed as the available window moves.
  createEffect(() => {
    if (selectedTime() !== undefined) setSelectedTime(timestamp())
  })
  const targets = createMemo<CrowdTarget[]>(() => buildings().map((building) => ({
    building: building.name, area: null, key: building.name, label: displayName(building.name),
    forecastSupported: building.forecastSupported,
  })))
  const requests = createMemo(() => planCrowdRequests(targets(), grid(), timestamp(), nowMs()))
  const queries = createQueries(() => ({
    queries: requests().map((request) => crowdQueryOptions(
      request.target, request.timestampMs, nowMs(), request.selected ? 1 : 0,
    )),
  }))
  createEffect(() => prioritizeCrowdRequests(requests()))
  const samples = createMemo(() => {
    const result = new Map<string, CrowdSample>()
    requests().forEach((request, index) => {
      result.set(`${request.target.key}|${request.timestampMs}`, queries[index] ?? {})
    })
    return result
  })
  const currentSamples = createMemo(() => new Map(targets().map((target) => [
    target.key,
    !target.forecastSupported && timestamp() > nowMs()
      ? { data: { status: 'unsupported', code: 'FORECAST_UNSUPPORTED', message: '予測非対応' } } as CrowdSample
      : samples().get(`${target.key}|${timestamp()}`),
  ])))
  const activity = createMemo(() => {
    const hour = 60 * 60 * 1000
    const points: { index: number, people: number | null }[] = []
    for (let time = Math.ceil(grid().startMs / hour) * hour; time <= grid().endMs; time += hour) {
      let people = 0
      let complete = true
      for (const target of targets()) {
        if (!target.forecastSupported && time > nowMs()) continue
        const data = samples().get(`${target.key}|${time}`)?.data
        if (data?.status === 'available') people += data.point.estimatedPeople
        else complete = false
      }
      points.push({ index: (time - grid().startMs) / CROWD_INTERVAL_MS, people: complete ? people : null })
    }
    return points
  })
  const layout = createMemo(() => new Map(squarify(targets().map((target) => {
    const data = currentSamples().get(target.key)?.data
    return {
      value: Math.max(data?.status === 'available' ? data.point.estimatedPeople : 0, 1),
      data: target.key,
    }
  }), viewport().width, viewport().height).map((rect) => [rect.data, rect])))

  onMount(() => {
    const resize = new ResizeObserver(([entry]) => setViewport({
      width: entry.contentRect.width, height: entry.contentRect.height,
    }))
    resize.observe(mapElement)
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', handleVisibility)
    onCleanup(() => {
      resize.disconnect()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    })
  })

  return (
    <div ref={mapElement} class="fixed inset-0 overflow-hidden bg-[#0a0c0f]">
      <For each={targets()}>{(target) => (
        <Cell target={target} rect={() => layout().get(target.key)} sample={() => currentSamples().get(target.key)} />
      )}</For>
      <Show when={buildings().length > 0}>
        <CrowdTimeSlider startTimeMs={grid().startMs} intervalMs={CROWD_INTERVAL_MS}
          pointCount={grid().pointCount} nowIndex={grid().nowIndex}
          activity={activity()} value={(timestamp() - grid().startMs) / CROWD_INTERVAL_MS}
          onChange={(index) => setSelectedTime(index === grid().nowIndex
            ? undefined : grid().startMs + index * CROWD_INTERVAL_MS)} />
      </Show>
    </div>
  )
}
