import { Show, createMemo } from 'solid-js'
import { Slider, SliderFill, SliderThumb, SliderTrack } from '@/components/ui/slider'

const CURVE_WIDTH = 48
const SLIDER_STEP_MINUTES = 5

export function sliderStep(intervalMs: number): number {
  return Math.max(1, Math.round((SLIDER_STEP_MINUTES * 60_000) / intervalMs))
}

export function maxSelectableIndex(pointCount: number, step: number): number {
  return Math.max(pointCount - 1 - ((pointCount - 1) % step), 0)
}

const TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const THUMB_CLASS =
  "size-5 rounded-none border-0 bg-transparent after:pointer-events-none after:absolute after:top-1/2 after:left-1/2 after:h-0.75 after:w-5 after:-translate-1/2 after:bg-primary after:content-[''] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background data-[orientation=vertical]:-left-2"

const LABEL_CLASS =
  'pointer-events-none absolute top-1/2 left-20 -translate-y-1/2 text-xs font-medium whitespace-nowrap text-foreground tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.65)]'

interface CrowdTimeSliderProps {
  startTimeMs: number
  intervalMs: number
  pointCount: number
  nowIndex?: number
  activity: { index: number, people: number | null }[]
  value: number
  onChange: (value: number) => void
}

export default function CrowdTimeSlider(props: CrowdTimeSliderProps) {
  const stepSize = () => sliderStep(props.intervalMs)
  const maxValue = () => maxSelectableIndex(props.pointCount, stepSize())
  const formatTime = (index: number) =>
    TIME_FORMATTER.format(new Date(props.startTimeMs + index * props.intervalMs))

  const curvePath = createMemo(() => {
    const activity = props.activity
    if (activity.length < 2) return ''

    const maximum = activity.reduce((max, point) => Math.max(max, point.people ?? 0), 1)
    const commands: string[] = []
    let connected = false
    for (const point of activity) {
      if (point.people === null) {
        connected = false
        continue
      }
      const x = (point.people / maximum) * CURVE_WIDTH
      commands.push(`${connected ? 'L' : 'M'} ${x.toFixed(2)} ${point.index}`)
      connected = true
    }
    return commands.join(' ')
  })

  return (
    <Slider
      class="fixed inset-y-0 left-6 z-50 my-auto h-lvh max-h-180 py-16"
      value={[props.value]}
      minValue={0}
      maxValue={maxValue()}
      step={stepSize()}
      orientation="vertical"
      inverted
      onChange={(values) => props.onChange(values[0])}
      aria-label="表示時刻"
    >
      <div
        class="pointer-events-none absolute inset-y-16 left-4 w-12 text-muted-foreground"
        aria-hidden="true"
      >
        <svg
          class="size-full overflow-visible"
          viewBox={`0 0 ${CURVE_WIDTH} ${maxValue()}`}
          preserveAspectRatio="none"
        >
          <path
            d={curvePath()}
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <Show when={props.nowIndex !== undefined && maxValue() > 0}>
          <div
            class="absolute -left-5 right-0 border-t border-dashed border-primary/45"
            style={{ top: `${((props.nowIndex ?? 0) / maxValue()) * 100}%` }}
          />
        </Show>
      </div>
      <SliderTrack class="data-[orientation=vertical]:before:-right-16">
        <SliderFill
          style={{
            top: `${Math.min(50, (props.value / Math.max(1, maxValue())) * 100)}%`,
            bottom: `${100 - Math.max(50, (props.value / Math.max(1, maxValue())) * 100)}%`,
          }}
        />
        <SliderThumb class={THUMB_CLASS} aria-label="表示時刻" aria-valuetext={formatTime(props.value)}>
          <span class={LABEL_CLASS}>{formatTime(props.value)}</span>
        </SliderThumb>
      </SliderTrack>
    </Slider>
  )
}
