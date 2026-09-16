const CROWD_URL = '/api/crowd'

export interface CrowdBuilding {
  name: string
  seatCapacity: number
  classrooms: { id: string | null, seatCapacity: number }[]
}

interface CrowdPointBase {
  timestamp: number
  intervalSeconds: number
  scope: { building: string, classroom: string | null }
  estimatedPeople: number
  seatCapacity: number
  seatUtilization: number
  overSeatCapacity: boolean
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
}

export type CrowdPoint = CrowdEstimate | CrowdForecast

export class RateLimitError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('crowd API rate limited')
    this.retryAfterMs = retryAfterMs
  }
}

export async function fetchBuildings(signal: AbortSignal): Promise<CrowdBuilding[]> {
  const response = await fetch(`${CROWD_URL}/v1/buildings`, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`crowd buildings: ${response.status}`)
  const data = await response.json() as { buildings: CrowdBuilding[] }
  return data.buildings
}

export async function fetchCrowdPoint(
  building: string,
  timestampMs: number,
  signal: AbortSignal,
): Promise<CrowdPoint | null> {
  const query = new URLSearchParams({
    building,
    timestamp: String(Math.floor(timestampMs / 1000)),
  })
  const response = await fetch(`${CROWD_URL}/v1/crowd?${query}`, { signal, cache: 'no-store' })
  if (response.status === 404) return null
  if (response.status === 429) {
    const retryInMs = Number.parseFloat(response.headers.get('x-retry-in') ?? '')
    const retryAfterSeconds = Number.parseFloat(response.headers.get('retry-after') ?? '')
    const retryAfterMs = Number.isFinite(retryInMs) && retryInMs > 0
      ? retryInMs
      : Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 1000
    throw new RateLimitError(retryAfterMs)
  }
  if (!response.ok) throw new Error(`crowd: ${response.status}`)
  return response.json() as Promise<CrowdPoint>
}
