// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import {
  CROWD_HORIZON_MS, CROWD_INTERVAL_MS, CrowdApiError, crowdQueryOptions,
  crowdRetryDelay, fetchBuildings, fetchCrowdPoint, prioritizeCrowdRequests, retryCrowdRequest,
  type CrowdEstimate, type CrowdForecast,
} from '../src/crowd'
import { buildCrowdGrid, planCrowdRequests, type CrowdTarget } from '../src/crowd-series'

const now = Date.parse('2026-09-28T12:03:45+09:00')
const scope = { building: 'kappa', area: null }
const target: CrowdTarget = { ...scope, key: 'kappa', label: 'Kappa', forecastSupported: true }
const estimate: CrowdEstimate = {
  scope, timestamp: Math.floor(now / 1000), intervalSeconds: 300,
  resultType: 'estimate', estimatedPeople: 30, connectedDevices: 45,
  devicesPerPerson: 1.5, seatCapacity: 100, seatUtilization: 0.3, overSeatCapacity: false,
  observedAt: Math.floor(now / 1000), dataFreshnessSeconds: 0,
}
const forecast: CrowdForecast = {
  scope, timestamp: Math.floor(now / 1000) + 3600, intervalSeconds: 300,
  resultType: 'forecast', estimatedPeople: 90, seatCapacity: 100, seatUtilization: 0.9,
  overSeatCapacity: false, forecastFrom: Math.floor(now / 1000), basedOnObservationAt: Math.floor(now / 1000),
  predictedInflow: 60, predictedOutflow: 0, currentLectureAttendance: 20,
  targetLectureAttendance: 80, confidence: 0.8, modelVersion: 'test', unmatchedLectureLocations: 0,
}

afterEach(() => vi.unstubAllGlobals())

describe('documented time and scope support', () => {
  it('keeps aligned endpoints inside the rolling 24-hour window', () => {
    for (const time of [now, Math.floor(now / CROWD_INTERVAL_MS) * CROWD_INTERVAL_MS]) {
      const grid = buildCrowdGrid(time)
      expect(grid.startMs).toBeGreaterThanOrEqual(time - CROWD_HORIZON_MS)
      expect(grid.endMs).toBeLessThanOrEqual(time + CROWD_HORIZON_MS)
      expect(grid.startMs % CROWD_INTERVAL_MS).toBe(0)
      expect(grid.endMs % CROWD_INTERVAL_MS).toBe(0)
      expect(grid.pointCount).toBe((grid.endMs - grid.startMs) / CROWD_INTERVAL_MS + 1)
      expect(grid.startMs + grid.nowIndex * CROWD_INTERVAL_MS).toBeLessThanOrEqual(time)
    }
    expect(buildCrowdGrid(now, false).endMs).toBe(Math.floor(now / CROWD_INTERVAL_MS) * CROWD_INTERVAL_MS)
  })

  it('requests only the selected five-minute point plus the hourly overview and omits unsupported forecasts', () => {
    const grid = buildCrowdGrid(now)
    const start = grid.startMs + grid.nowIndex * CROWD_INTERVAL_MS
    const targets = [target, { ...target, building: 'alpha', key: 'alpha', forecastSupported: false }]
    const requests = planCrowdRequests(targets, grid, start + 3 * CROWD_INTERVAL_MS, now)
    expect(requests.filter((request) => request.selected && request.target.key === 'kappa')).toHaveLength(1)
    expect(requests.some((request) => request.target.key === 'alpha' && request.timestampMs > now)).toBe(false)
    expect(new Set(requests.map((request) => `${request.target.key}|${request.timestampMs}`)).size).toBe(requests.length)
    expect(requests[0].timestampMs).toBe(start + 3 * CROWD_INTERVAL_MS)
    expect(requests.filter((request) => !request.selected).every((request) => request.timestampMs % 3_600_000 === 0)).toBe(true)
  })

  it('replaces a cached forecast with an estimate after its timestamp passes', async () => {
    const client = new QueryClient()
    const timestamp = Date.now() + CROWD_INTERVAL_MS
    const before = crowdQueryOptions(scope, timestamp, timestamp - 1)
    const after = crowdQueryOptions(scope, timestamp, timestamp)
    client.setQueryData(before.queryKey, { status: 'available', point: forecast })
    expect(client.getQueryData(after.queryKey)).toBeUndefined()
    const fetch = vi.fn().mockResolvedValue(Response.json(estimate))
    vi.stubGlobal('fetch', fetch)
    expect(await client.fetchQuery(after)).toEqual({ status: 'available', point: estimate })
    expect(fetch).toHaveBeenCalledTimes(1)
    client.clear()
  })
})

describe('API transport', () => {
  it('sends documented area identifiers, seconds, and no classroom parameter', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(estimate))
    vi.stubGlobal('fetch', fetch)
    await fetchCrowdPoint({ building: 'mu', area: 'b1' }, now, new AbortController().signal)
    const url = new URL(fetch.mock.calls[0][0], 'https://example.test')
    expect(url.pathname).toBe('/api/crowd/v1/crowd')
    expect(Object.fromEntries(url.searchParams)).toEqual({ building: 'mu', area: 'b1', timestamp: String(Math.floor(now / 1000)) })
    await fetchCrowdPoint(scope, now, new AbortController().signal)
    expect(new URL(fetch.mock.calls[1][0], 'https://example.test').searchParams.has('area')).toBe(false)
  })

  it('preserves 404 and 422 distinctions and does not retry invalid queries', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: 'DATA_UNAVAILABLE', message: 'No observation' } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'FORECAST_UNSUPPORTED', message: 'Unsupported' } }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'INVALID_QUERY', message: 'Invalid' } }, { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchCrowdPoint(scope, now, new AbortController().signal)).toEqual({ status: 'unavailable', code: 'DATA_UNAVAILABLE', message: 'No observation' })
    expect(await fetchCrowdPoint(scope, now, new AbortController().signal)).toMatchObject({ status: 'unsupported', code: 'FORECAST_UNSUPPORTED' })
    await expect(fetchCrowdPoint(scope, now, new AbortController().signal)).rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' })
    expect(retryCrowdRequest(0, new CrowdApiError(400, '', ''))).toBe(false)
  })

  it('honors rate-limit delays for both the catalog and crowd requests', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { 'x-retry-in': '350' } }))
      .mockResolvedValueOnce(Response.json(estimate))
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { 'retry-after': '0.35' } }))
    vi.stubGlobal('fetch', fetch)
    const error = await fetchBuildings(new AbortController().signal).catch((error: CrowdApiError) => error)
    expect(error).toBeInstanceOf(CrowdApiError)
    expect(crowdRetryDelay(0, error as CrowdApiError)).toBe(350)
    const start = Date.now()
    await fetchCrowdPoint(scope, now, new AbortController().signal)
    expect(Date.now() - start).toBeGreaterThanOrEqual(300)
    await expect(fetchCrowdPoint(scope, now, new AbortController().signal)).rejects.toMatchObject({ retryAfterMs: 350 })
  })

  it('prioritizes a newly selected queued point and cancels obsolete requests', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(new URL(url, 'https://example.test').searchParams.get('area') ?? '')
      return Response.json(estimate)
    }))
    const controller = new AbortController()
    const canceled = fetchCrowdPoint({ ...scope, area: 'east' }, now, controller.signal, 0).catch((error) => error)
    controller.abort()
    const west = fetchCrowdPoint({ ...scope, area: 'west' }, now, new AbortController().signal, 0)
    const floor = fetchCrowdPoint({ ...scope, area: '1f' }, now, new AbortController().signal, 0)
    prioritizeCrowdRequests([{ target: { ...scope, area: '1f' }, timestampMs: now, selected: true }])
    await Promise.all([west, floor, canceled])
    expect(calls).toEqual(['1f', 'west'])
  })
})
