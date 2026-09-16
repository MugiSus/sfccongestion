import { Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import CrowdTimeRangeSlider from '@/components/crowd-time-range-slider'
import { fetchBuildings, fetchCrowdPoint, RateLimitError, type CrowdBuilding, type CrowdPoint } from './crowd'
import { squarify, type TreemapRect } from './treemap'

const GRID_INTERVAL_MS = 60 * 60 * 1000
const GRID_HALF_POINTS = 24
const GRID_POINT_COUNT = GRID_HALF_POINTS * 2 + 1
const NOW_INDEX = GRID_HALF_POINTS
const DEFAULT_WINDOW_POINTS = 2
const REQUEST_GAP_MS = 125
const RETRY_DELAY_MS = 3000
const SCAN_INTERVAL_MS = 5 * 60 * 1000
const NOW_TICK_MS = 60 * 1000
const CURRENT_TTL_MS = 5 * 60 * 1000
const NEAR_TTL_MS = 15 * 60 * 1000
const FAR_TTL_MS = 60 * 60 * 1000
const UNAVAILABLE_RETRY_MS = 60 * 60 * 1000
const NEAR_HORIZON_MS = 3 * 60 * 60 * 1000
const STORAGE_KEY = 'sfccongestion:crowd:v1'
const STORAGE_MAX_AGE_MS = 50 * 60 * 60 * 1000
const STORAGE_SAVE_DELAY_MS = 5000

interface Grid {
  startMs: number
  intervalMs: number
  pointCount: number
}

interface CacheEntry {
  point: CrowdPoint | null
  fetchedAt: number
}

interface Reading {
  utilization: number | null
  people: number | null
}

interface Viewport {
  width: number
  height: number
}

interface CellProps {
  buildingKey: string
  rect: () => TreemapRect<string> | undefined
  reading: () => Reading | undefined
}

function alignHour(ms: number): number {
  return Math.floor(ms / GRID_INTERVAL_MS) * GRID_INTERVAL_MS
}

function buildGrid(nowMs: number): Grid {
  return {
    startMs: alignHour(nowMs) - GRID_HALF_POINTS * GRID_INTERVAL_MS,
    intervalMs: GRID_INTERVAL_MS,
    pointCount: GRID_POINT_COUNT,
  }
}

function pointKey(building: string, timestamp: number): string {
  return `${building}|${timestamp}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function loadStoredPoints(): Map<string, CacheEntry> {
  const entries = new Map<string, CacheEntry>()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return entries
    const stored = JSON.parse(raw) as [string, CrowdPoint][]
    const cutoffMs = Date.now() - STORAGE_MAX_AGE_MS
    for (const [key, point] of stored) {
      if (point && point.timestamp * 1000 >= cutoffMs) {
        entries.set(key, { point, fetchedAt: 0 })
      }
    }
  } catch {
    return new Map()
  }
  return entries
}

function isStale(entry: CacheEntry | undefined, timestamp: number, nowMs: number): boolean {
  if (!entry) return true
  if (entry.point === null) return nowMs - entry.fetchedAt >= UNAVAILABLE_RETRY_MS
  if (timestamp + GRID_INTERVAL_MS <= nowMs) return false
  const age = nowMs - entry.fetchedAt
  if (timestamp <= nowMs) return age >= CURRENT_TTL_MS
  if (timestamp <= nowMs + NEAR_HORIZON_MS) return age >= NEAR_TTL_MS
  return age >= FAR_TTL_MS
}

function displayName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
}

function utilizationColor(utilization: number | null | undefined): string {
  if (utilization == null) return 'hsl(215 10% 26%)'
  const ratio = Math.min(Math.max(utilization, 0), 1)
  return `hsl(${(1 - ratio) * 130} 68% 41%)`
}

function statsText(reading: Reading | undefined): string {
  if (!reading) return ''
  const utilization = reading.utilization == null ? '–' : `${Math.round(reading.utilization * 100)}%`
  const people = reading.people == null ? '–' : `${Math.round(reading.people)}人`
  return `${utilization} · ${people}`
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
  const name = () => displayName(props.buildingKey)
  const stats = () => statsText(props.reading())

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
      'background-color': utilizationColor(props.reading()?.utilization),
    }
  }

  return (
    <div
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
  const cache = loadStoredPoints()
  const [buildings, setBuildings] = createSignal<CrowdBuilding[]>([])
  const [nowMs, setNowMs] = createSignal(alignHour(Date.now()))
  const [selection, setSelection] = createSignal<[number, number]>([0, 0])
  const [version, setVersion] = createSignal(0)
  const [viewport, setViewport] = createSignal<Viewport>({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  const grid = createMemo<Grid>((previous) => {
    const next = buildGrid(nowMs())
    return previous && previous.startMs === next.startMs ? previous : next
  })

  let previousStartMs = 0
  createEffect(() => {
    const current = grid()
    if (previousStartMs === 0) {
      previousStartMs = current.startMs
      return
    }
    const delta = Math.round((current.startMs - previousStartMs) / current.intervalMs)
    previousStartMs = current.startMs
    if (delta === 0) return
    setSelection(([start, end]) => {
      const last = current.pointCount - 1
      const nextStart = Math.min(Math.max(start + delta, 0), last)
      const nextEnd = Math.min(Math.max(end + delta, nextStart), last)
      return [nextStart, nextEnd]
    })
  })

  const readings = createMemo(() => {
    version()
    const current = grid()
    const [start, end] = selection()
    const result = new Map<string, Reading>()
    for (const building of buildings()) {
      let utilizationSum = 0
      let peopleSum = 0
      let count = 0
      for (let index = start; index <= end; index += 1) {
        const entry = cache.get(pointKey(building.name, current.startMs + index * current.intervalMs))
        if (!entry?.point) continue
        utilizationSum += entry.point.seatUtilization
        peopleSum += entry.point.estimatedPeople
        count += 1
      }
      result.set(building.name, count === 0
        ? { utilization: null, people: null }
        : { utilization: utilizationSum / count, people: peopleSum / count })
    }
    return result
  })

  const activity = createMemo(() => {
    version()
    const current = grid()
    const totals = new Array<number>(current.pointCount).fill(0)
    for (const building of buildings()) {
      for (let index = 0; index < current.pointCount; index += 1) {
        const entry = cache.get(pointKey(building.name, current.startMs + index * current.intervalMs))
        if (entry?.point) totals[index] += entry.point.estimatedPeople
      }
    }
    return totals
  })

  const layout = createMemo(() => {
    const { width, height } = viewport()
    const current = readings()
    const items = buildings().map((building) => ({
      value: Math.max(current.get(building.name)?.people ?? 0, 1),
      data: building.name,
    }))
    return new Map(squarify(items, width, height).map((rect) => [rect.data, rect]))
  })

  onMount(() => {
    const handleResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', handleResize)
    const controller = new AbortController()
    const queue: { building: string, timestamp: number, attempts: number }[] = []
    const queued = new Set<string>()
    let pumping = false
    let disposed = false
    let saveTimer: number | undefined

    const scheduleSave = () => {
      if (saveTimer !== undefined) return
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined
        const cutoffMs = Date.now() - STORAGE_MAX_AGE_MS
        const stored: [string, CrowdPoint][] = []
        for (const [key, entry] of cache) {
          if (entry.point && entry.point.timestamp * 1000 >= cutoffMs) stored.push([key, entry.point])
        }
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
        } catch {
          window.localStorage.removeItem(STORAGE_KEY)
        }
      }, STORAGE_SAVE_DELAY_MS)
    }

    const enqueue = (building: string, timestamp: number, attempts = 0) => {
      const key = pointKey(building, timestamp)
      if (queued.has(key)) return
      queued.add(key)
      queue.push({ building, timestamp, attempts })
    }

    const pump = async () => {
      if (pumping || disposed) return
      pumping = true
      while (queue.length > 0 && !disposed) {
        const task = queue.shift()!
        const key = pointKey(task.building, task.timestamp)
        queued.delete(key)
        try {
          const point = await fetchCrowdPoint(task.building, task.timestamp, controller.signal)
          cache.set(key, { point, fetchedAt: Date.now() })
          setVersion((value) => value + 1)
          scheduleSave()
        } catch (error) {
          if (disposed || controller.signal.aborted) break
          if (error instanceof RateLimitError) {
            await delay(error.retryAfterMs)
            if (!disposed) enqueue(task.building, task.timestamp, task.attempts)
          } else if (task.attempts < 2) {
            await delay(RETRY_DELAY_MS)
            if (!disposed) enqueue(task.building, task.timestamp, task.attempts + 1)
          }
        }
        if (!disposed) await delay(REQUEST_GAP_MS)
      }
      pumping = false
    }

    const scan = () => {
      const list = buildings()
      if (list.length === 0) return
      const nowMs = Date.now()
      const currentHourMs = alignHour(nowMs)
      const offsets = [0]
      for (let offset = 1; offset <= GRID_HALF_POINTS; offset += 1) {
        offsets.push(offset, -offset)
      }
      for (const offset of offsets) {
        const timestamp = currentHourMs + offset * GRID_INTERVAL_MS
        for (const building of list) {
          const entry = cache.get(pointKey(building.name, timestamp))
          if (isStale(entry, timestamp, nowMs)) enqueue(building.name, timestamp)
        }
      }
      void pump()
    }

    const loadBuildings = async () => {
      try {
        const list = await fetchBuildings(controller.signal)
        if (disposed) return
        setBuildings(list)
        if (selection()[1] === 0) {
          setSelection([NOW_INDEX, NOW_INDEX + DEFAULT_WINDOW_POINTS])
        }
        scan()
      } catch {
        if (!disposed && !controller.signal.aborted) window.setTimeout(loadBuildings, 60_000)
      }
    }

    void loadBuildings()
    const scanTimer = window.setInterval(scan, SCAN_INTERVAL_MS)
    const nowTimer = window.setInterval(() => setNowMs(alignHour(Date.now())), NOW_TICK_MS)

    onCleanup(() => {
      disposed = true
      controller.abort()
      if (saveTimer !== undefined) window.clearTimeout(saveTimer)
      window.clearInterval(scanTimer)
      window.clearInterval(nowTimer)
      window.removeEventListener('resize', handleResize)
    })
  })

  return (
    <div class="fixed inset-0 overflow-hidden bg-[#0a0c0f]">
      <Index each={buildings()}>
        {(building) => {
          const rect = createMemo(() => layout().get(building().name))
          const reading = createMemo(() => readings().get(building().name))
          return <Cell buildingKey={building().name} rect={rect} reading={reading} />
        }}
      </Index>
      <Show when={buildings().length > 0}>
        <CrowdTimeRangeSlider
          startTimeMs={grid().startMs}
          intervalMs={grid().intervalMs}
          pointCount={grid().pointCount}
          nowIndex={NOW_INDEX}
          activity={activity()}
          value={selection()}
          onChange={setSelection}
        />
      </Show>
    </div>
  )
}
