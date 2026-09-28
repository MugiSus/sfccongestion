import { CROWD_HORIZON_MS, CROWD_INTERVAL_MS, type CrowdResult, type CrowdScope } from './crowd.ts'

export interface CrowdTarget extends CrowdScope {
  key: string
  label: string
  forecastSupported: boolean
}

export interface CrowdGrid {
  startMs: number
  endMs: number
  pointCount: number
  nowIndex: number
}

export interface CrowdSample {
  data?: CrowdResult
  error?: Error | null
}

export function buildCrowdGrid(nowMs: number, forecastSupported = true): CrowdGrid {
  // Round inward so neither endpoint falls outside the API's rolling 24-hour limit.
  const startMs = Math.ceil((nowMs - CROWD_HORIZON_MS) / CROWD_INTERVAL_MS) * CROWD_INTERVAL_MS
  const endMs = Math.floor((nowMs + (forecastSupported ? CROWD_HORIZON_MS : 0)) / CROWD_INTERVAL_MS) * CROWD_INTERVAL_MS
  return {
    startMs,
    endMs,
    pointCount: (endMs - startMs) / CROWD_INTERVAL_MS + 1,
    nowIndex: (Math.floor(nowMs / CROWD_INTERVAL_MS) * CROWD_INTERVAL_MS - startMs) / CROWD_INTERVAL_MS,
  }
}

export function planCrowdRequests(
  targets: CrowdTarget[],
  grid: CrowdGrid,
  selectedTime: number,
  nowMs: number,
) {
  // Keep hourly overview samples alongside the single selected five-minute reading.
  const timestamps = new Set<number>([selectedTime])
  const hour = 60 * 60 * 1000
  for (let time = Math.ceil(grid.startMs / hour) * hour; time <= grid.endMs; time += hour) timestamps.add(time)
  return [...timestamps].filter((time) => time >= grid.startMs && time <= grid.endMs)
    .sort((a, b) => Math.abs(a - selectedTime) - Math.abs(b - selectedTime))
    .flatMap((timestampMs) => targets
      .filter((target) => target.forecastSupported || timestampMs <= nowMs)
      .map((target) => ({
        target,
        timestampMs,
        selected: timestampMs === selectedTime,
      })))
}

