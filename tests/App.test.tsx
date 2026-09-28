import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import App from '../src/App'
import type { CrowdBuilding } from '../src/crowd'

const buildings: CrowdBuilding[] = [
  {
    name: 'kappa', seatCapacity: 100, estimateSupported: true, forecastSupported: true,
    areas: [
      { id: 'east', kind: 'wing', label: '東側', alias: 'lecture', seatCapacity: 60 },
      { id: 'west', kind: 'wing', label: '西側', alias: 'research', seatCapacity: 40 },
      { id: '1f', kind: 'floor', label: '1階', alias: null, seatCapacity: 100 },
      { id: '3f', kind: 'floor', label: '3階', alias: null, seatCapacity: null },
    ],
    classrooms: [{ id: '11', seatCapacity: 60, areas: ['1f', 'east'] }],
  },
  {
    name: 'alpha', seatCapacity: null, estimateSupported: true, forecastSupported: false,
    areas: [{ id: 'bf', kind: 'floor', label: '地下階', alias: null, seatCapacity: null }], classrooms: [],
  },
]
const clients: QueryClient[] = []

afterEach(async () => {
  cleanup()
  for (const client of clients) {
    await client.cancelQueries()
    client.clear()
  }
  clients.length = 0
})

function renderApp() {
  const client = new QueryClient()
  clients.push(client)
  return render(() => <QueryClientProvider client={client}><App /></QueryClientProvider>)
}

function installApi() {
  const requested: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'https://example.test')
    requested.push(url)
    if (url.pathname.endsWith('/buildings')) return Response.json({ buildings })
    const timestamp = Number(url.searchParams.get('timestamp'))
    const building = url.searchParams.get('building')!
    const area = url.searchParams.get('area')
    const isForecast = timestamp * 1000 > Date.now()
    const capacity = building === 'alpha' || area === '3f' ? null : 100
    const people = building === 'alpha' ? 7 : isForecast ? 84 : 42
    const base = {
      timestamp, intervalSeconds: 300, scope: { building, area }, estimatedPeople: people,
      seatCapacity: capacity, seatUtilization: capacity === null ? null : people / capacity,
      overSeatCapacity: capacity === null ? null : false,
    }
    return Response.json(isForecast ? {
      ...base, resultType: 'forecast', forecastFrom: timestamp - 3600, basedOnObservationAt: timestamp - 3600,
      predictedInflow: 12, predictedOutflow: 3, currentLectureAttendance: 10, targetLectureAttendance: 20,
      confidence: 0.8, modelVersion: 'test', unmatchedLectureLocations: 0,
    } : {
      ...base, resultType: 'estimate', observedAt: timestamp, connectedDevices: people * 1.5,
      devicesPerPerson: 1.5, dataFreshnessSeconds: 0,
    })
  }))
  return requested
}

it('renders only the full-screen treemap and one time slider', async () => {
  const requested = installApi()
  const { container } = renderApp()
  await screen.findByLabelText('Kappa 42% · 42人')
  await screen.findByLabelText('Alpha – · 7人')
  expect(screen.getAllByRole('slider')).toHaveLength(1)
  expect(screen.getByRole('slider').getAttribute('aria-label')).toBe('表示時刻')
  expect(container.querySelector('select, button, details, header, footer, input[type="datetime-local"]')).toBeNull()
  expect(container.textContent).not.toContain('一部')
  expect(container.textContent).not.toContain('読み込み中')
  expect(requested.some((url) => url.searchParams.has('area'))).toBe(false)
})

it('changes a single timestamp in five-minute steps without requesting unsupported forecasts', async () => {
  const requested = installApi()
  renderApp()
  await screen.findByLabelText('Kappa 42% · 42人')
  const slider = screen.getByRole('slider')
  const index = Number(slider.getAttribute('aria-valuenow'))
  const initialTimestamp = Number(requested.find((url) => url.searchParams.get('building') === 'kappa')!.searchParams.get('timestamp'))
  await fireEvent.keyDown(slider, { key: 'ArrowUp' })
  await waitFor(() => expect(Number(slider.getAttribute('aria-valuenow'))).toBe(index + 1))
  const nextTimestamp = initialTimestamp + 300
  await waitFor(() => expect(requested.some((url) => url.searchParams.get('building') === 'kappa' && Number(url.searchParams.get('timestamp')) === nextTimestamp)).toBe(true))
  await screen.findByLabelText('Kappa 84% · 84人')
  await screen.findByLabelText('Alpha –')
  expect(requested.some((url) => url.searchParams.get('building') === 'alpha' && Number(url.searchParams.get('timestamp')) * 1000 > Date.now())).toBe(false)
  expect(screen.getAllByRole('slider')).toHaveLength(1)
  await fireEvent.keyDown(slider, { key: 'ArrowDown' })
  await screen.findByLabelText('Alpha – · 7人')
  await screen.findByLabelText('Kappa 42% · 42人')
})
