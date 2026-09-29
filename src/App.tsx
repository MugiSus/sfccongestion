import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createQueries, createQuery, keepPreviousData } from '@tanstack/solid-query'
import CrowdAdviceMarquee from '@/components/crowd-advice-marquee'
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
      building: building.name, area: area.id, key: `${building.name}/${area.id}`,
      label: `${building.name}-${area.id}`,
      forecastSupported: building.forecastSupported,
    })),
  ]))
  // Retain the displayed tree while a newly selected timestamp is loading.
  const currentQuery = createQuery(() => ({
    ...crowdQueryOptions(timestamp(), nowMs()),
    placeholderData: keepPreviousData,
  }))
  const requests = createMemo(() => planCrowdRequests(grid(), timestamp()))
  const queries = createQueries(() => ({
    queries: requests().map((request) => crowdQueryOptions(
      request.timestampMs, nowMs(), request.selected ? 1 : 0,
    )),
  }))
  createEffect(() => prioritizeCrowdRequests(requests()))
  const samples = createMemo(() => {
    const result = new Map<string, CrowdSample>()
    requests().forEach((request, index) => {
      const query = queries[index]
      for (const building of query?.data?.buildings ?? []) {
        result.set(`${building.name}|${request.timestampMs}`, { data: building.crowd, error: query?.error })
        for (const area of building.areas) {
          result.set(`${building.name}/${area.id}|${request.timestampMs}`, { data: area.crowd, error: query?.error })
        }
      }
    })
    return result
  })
  const currentSamples = createMemo(() => {
    const result = new Map<string, CrowdSample>()
    for (const building of currentQuery.data?.buildings ?? []) {
      result.set(building.name, { data: building.crowd })
      for (const area of building.areas) {
        result.set(`${building.name}/${area.id}`, { data: area.crowd })
      }
    }
    return result
  })
  const activity = createMemo(() => {
    const hour = 60 * 60 * 1000
    const points: { index: number, people: number | null }[] = []
    for (let time = Math.ceil(grid().startMs / hour) * hour; time <= grid().endMs; time += hour) {
      let people = 0
      let complete = true
      for (const target of targets()) {
        if (target.area !== null || (!target.forecastSupported && time > nowMs())) continue
        const data = samples().get(`${target.key}|${time}`)?.data
        if (data?.status === 'ok') people += data.estimatedPeople
        else complete = false
      }
      points.push({ index: (time - grid().startMs) / CROWD_INTERVAL_MS, people: complete ? people : null })
    }
    return points
  })
  // The first observation is drawn directly, without animating placeholder weights.
  const data = createMemo(() => currentQuery.data
    ? buildCrowdTreemapData(targets(), currentSamples()) : [])

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
      <HierarchyTreemap data={data()} class="fixed inset-x-0 top-0 bottom-6" ariaLabel="棟・階別の推定人数" />
      <CrowdAdviceMarquee />
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
