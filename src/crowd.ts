import { queryOptions } from '@tanstack/solid-query'
import PQueue from 'p-queue'

const CROWD_URL = 'https://crowd-api.sfc.sz7.jp'
export const CROWD_INTERVAL_MS = 5 * 60 * 1000
export const CROWD_HORIZON_MS = 24 * 60 * 60 * 1000

export interface CrowdArea {
  id: string
  kind: 'wing' | 'floor'
  label: string
  alias: string | null
  seatCapacity: number | null
}

export interface CrowdBuilding {
  name: string
  seatCapacity: number | null
  estimateSupported: true
  forecastSupported: boolean
  areas: CrowdArea[]
  classrooms: { id: string | null, seatCapacity: number, areas: string[] }[]
}

export interface CrowdScope {
  building: string
  area: string | null
}

interface CrowdPointBase {
  status: 'ok'
  timestamp: number
  intervalSeconds: 300
  estimatedPeople: number
  seatCapacity: number | null
  seatUtilization: number | null
  overSeatCapacity: boolean | null
}

export interface CrowdEstimate extends CrowdPointBase {
  resultType: 'estimate'
  observedAt: number
  connectedDevices: number
  devicesPerPerson: number
  dataFreshnessSeconds: number
}

export interface CrowdForecast extends CrowdPointBase {
  resultType: 'forecast'
  forecastFrom: number
  basedOnObservationAt: number
  predictedInflow: number
  predictedOutflow: number
  currentLectureAttendance: number
  targetLectureAttendance: number
  confidence: number
  modelVersion: string
  unmatchedLectureLocations: number
  loungeOverflowDemand?: number
}

export type CrowdPoint = CrowdEstimate | CrowdForecast
export type CrowdResult =
  | CrowdPoint
  | { status: 'error', error: { code: 'DATA_UNAVAILABLE' | 'FORECAST_UNSUPPORTED', message: string } }

export interface CrowdTree {
  timestamp: number
  buildings: {
    name: string
    crowd?: CrowdResult
    areas: (Pick<CrowdArea, 'id' | 'kind' | 'label' | 'alias'> & { crowd: CrowdResult })[]
  }[]
}

export interface CrowdAdvice {
  advice: string
  generatedAt: number
  forecastUntil: number
  coveredBuildings: string[]
  model: string
}

export class CrowdApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterMs: number

  constructor(status: number, code: string, message: string, retryAfterMs = 0) {
    super(message)
    this.name = 'CrowdApiError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

// Spread requests out, including retries and catalog requests, across one shared queue.
const requestQueue = new PQueue({ concurrency: 2, intervalCap: 1, interval: 150, strict: true })
const queuedRequests = new Map<string, AbortSignal>()
let resumeTimer: ReturnType<typeof setTimeout> | undefined
let resumeAt = 0

async function requestJson<T>(path: string, signal: AbortSignal, priority: number, id = path): Promise<T> {
  queuedRequests.set(id, signal)
  return requestQueue.add(async () => {
    queuedRequests.delete(id)
    const response = await fetch(`${CROWD_URL}${path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      cache: 'no-store',
    })
    if (response.ok) return response.json() as Promise<T>

    let retryAfterMs = 0
    if (response.status === 429) {
      const retryIn = Number.parseFloat(response.headers.get('x-retry-in') ?? '')
      const retryAfter = response.headers.get('retry-after') ?? ''
      const seconds = Number(retryAfter)
      const serverDelay = Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : Date.parse(retryAfter) - Date.now()
      retryAfterMs = Number.isFinite(retryIn) && retryIn > 0
        ? retryIn
        : Number.isFinite(serverDelay) && serverDelay > 0 ? serverDelay : 1000
      resumeAt = Math.max(resumeAt, Date.now() + retryAfterMs)
      requestQueue.pause()
      clearTimeout(resumeTimer)
      resumeTimer = setTimeout(() => requestQueue.start(), resumeAt - Date.now())
    }

    const body = await response.json().catch(() => null) as {
      error?: { code?: string, message?: string }
    } | null
    throw new CrowdApiError(
      response.status,
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ?? `データの取得に失敗しました (${response.status})`,
      retryAfterMs,
    )
  }, { signal, priority, id }).finally(() => {
    if (queuedRequests.get(id) === signal) queuedRequests.delete(id)
  })
}

export function prioritizeCrowdRequests(requests: { timestampMs: number, selected: boolean }[]) {
  for (const request of requests) {
    const id = String(request.timestampMs)
    const signal = queuedRequests.get(id)
    if (signal && !signal.aborted) requestQueue.setPriority(id, request.selected ? 1 : 0)
  }
}

export function retryCrowdRequest(failures: number, error: Error): boolean {
  if (error instanceof CrowdApiError) {
    if (error.status === 429) return failures < 5
    if (error.status < 500) return false
  }
  return error.name !== 'AbortError' && failures < 2
}

export function crowdRetryDelay(attempt: number, error: Error): number {
  return error instanceof CrowdApiError && error.retryAfterMs > 0
    ? error.retryAfterMs
    : Math.min(1000 * 2 ** attempt, 30_000)
}

export async function fetchBuildings(signal: AbortSignal): Promise<CrowdBuilding[]> {
  const data = await requestJson<{ buildings: CrowdBuilding[] }>('/v1/buildings', signal, 2)
  return data.buildings
}

export function fetchCrowdAdvice(signal: AbortSignal): Promise<CrowdAdvice> {
  return requestJson<CrowdAdvice>('/v1/crowd/advice', signal, 2)
}

export async function fetchCrowdTree(
  timestampMs: number,
  signal: AbortSignal,
  priority = 1,
): Promise<CrowdTree> {
  const query = new URLSearchParams({
    timestamp: String(Math.floor(timestampMs / 1000)),
  })
  return requestJson<CrowdTree>(`/v1/crowd?${query}`, signal, priority, String(timestampMs))
}

export function crowdQueryOptions(timestampMs: number, nowMs: number, priority = 1) {
  const resultType = timestampMs <= nowMs ? 'estimate' : 'forecast'
  // Only a complete, fresh observation tree can stop refreshing permanently.
  const isFinalEstimate = (data: CrowdTree | undefined) => timestampMs + 2 * CROWD_INTERVAL_MS < Date.now()
    && !!data?.buildings.length && data.buildings.every((building) =>
      [building.crowd, ...building.areas.map((area) => area.crowd)].every((point) =>
        point?.status === 'ok' && point.resultType === 'estimate' && point.dataFreshnessSeconds <= 300))
  return queryOptions({
    // A forecast must be replaced with an observation when its target time passes.
    queryKey: ['crowd-tree', timestampMs, resultType] as const,
    queryFn: ({ signal }) => fetchCrowdTree(timestampMs, signal, priority),
    staleTime: (query) => isFinalEstimate(query.state.data) ? Infinity : CROWD_INTERVAL_MS,
    refetchInterval: (query) => isFinalEstimate(query.state.data) ? false : CROWD_INTERVAL_MS,
    gcTime: CROWD_HORIZON_MS,
    retry: retryCrowdRequest,
    retryDelay: crowdRetryDelay,
  })
}
