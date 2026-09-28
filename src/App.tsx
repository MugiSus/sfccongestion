import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createQueries, createQuery } from '@tanstack/solid-query'
import CrowdTimeSlider from '@/components/crowd-time-slider'
import HierarchyTreemap from '@/components/hierarchy-treemap'
import {
  CROWD_INTERVAL_MS, crowdQueryOptions, crowdRetryDelay, fetchBuildings,
  prioritizeCrowdRequests, retryCrowdRequest,
} from './crowd'
import {
  buildCrowdGrid, planCrowdRequests,
  type CrowdSample, type CrowdTarget,
} from './crowd-series'
import { buildCrowdTreemapData } from './crowd-treemap'

export default function App() {
  const [nowMs, setNowMs] = createSignal(Date.now())
  const [selectedTime, setSelectedTime] = createSignal<number>()

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
  const targets = createMemo<CrowdTarget[]>(() => buildings().flatMap((building) => [
    {
      building: building.name, area: null, key: building.name,
      label: building.name.charAt(0).toUpperCase() + building.name.slice(1),
      forecastSupported: building.forecastSupported,
    },
    ...building.areas.filter((area) => area.kind === 'floor').map((area) => ({
      building: building.name, area: area.id, key: `${building.name}/${area.id}`, label: area.id,
      forecastSupported: building.forecastSupported,
    })),
  ]))
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
        if (target.area !== null || (!target.forecastSupported && time > nowMs())) continue
        const data = samples().get(`${target.key}|${time}`)?.data
        if (data?.status === 'available') people += data.point.estimatedPeople
        else complete = false
      }
      points.push({ index: (time - grid().startMs) / CROWD_INTERVAL_MS, people: complete ? people : null })
    }
    return points
  })
  const data = createMemo(() => buildCrowdTreemapData(targets(), currentSamples()))

  onMount(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', handleVisibility)
    onCleanup(() => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    })
  })

  return (
    <>
      <HierarchyTreemap data={data()} class="fixed inset-0" ariaLabel="棟・階別の推定人数" />
      <Show when={buildings().length > 0}>
        <CrowdTimeSlider startTimeMs={grid().startMs} intervalMs={CROWD_INTERVAL_MS}
          pointCount={grid().pointCount} nowIndex={grid().nowIndex}
          activity={activity()} value={(timestamp() - grid().startMs) / CROWD_INTERVAL_MS}
          onChange={(index) => setSelectedTime(index === grid().nowIndex
            ? undefined : grid().startMs + index * CROWD_INTERVAL_MS)} />
      </Show>
    </>
  )
}
