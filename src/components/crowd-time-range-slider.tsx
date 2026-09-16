import { Show, createMemo } from 'solid-js'
import { Slider, SliderFill, SliderThumb, SliderTrack } from '@/components/ui/slider'

const CURVE_WIDTH = 48
const CURVE_SMOOTHING_RADIUS = 3
const CURVE_MAX_SAMPLES = 600
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

interface CrowdTimeRangeSliderProps {
  startTimeMs: number
  intervalMs: number
  pointCount: number
  nowIndex?: number
  activity: number[]
  value: [number, number]
  onChange: (value: [number, number]) => void
}

export default function CrowdTimeRangeSlider(props: CrowdTimeRangeSliderProps) {
  let rangeDrag:
    | {
        pointerId: number
        pointerStartY: number
        trackHeight: number
        startValue: number
        endValue: number
      }
    | undefined

  const stepSize = () => sliderStep(props.intervalMs)
  const maxValue = () => maxSelectableIndex(props.pointCount, stepSize())
  const formatTime = (index: number) =>
    TIME_FORMATTER.format(new Date(props.startTimeMs + index * props.intervalMs))

  const curvePath = createMemo(() => {
    const activity = props.activity
    if (activity.length < 2) return ''

    const smoothed = activity.map((_, index) => {
      let weightedCount = 0
      let totalWeight = 0
      for (
        let offset = -CURVE_SMOOTHING_RADIUS;
        offset <= CURVE_SMOOTHING_RADIUS;
        offset += 1
      ) {
        const value = activity[index + offset]
        if (value === undefined) continue
        const weight = CURVE_SMOOTHING_RADIUS + 1 - Math.abs(offset)
        weightedCount += value * weight
        totalWeight += weight
      }
      return totalWeight === 0 ? 0 : weightedCount / totalWeight
    })
    const maximum = smoothed.reduce((max, value) => Math.max(max, value), 1)
    const lastIndex = maxValue()
    const sampleStep = Math.max(1, Math.ceil((lastIndex + 1) / CURVE_MAX_SAMPLES))
    const commands: string[] = []
    for (let index = 0; index <= lastIndex; index += sampleStep) {
      const x = (smoothed[index] / maximum) * CURVE_WIDTH
      commands.push(`${commands.length === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${index}`)
    }
    return commands.join(' ')
  })

  const clampIndex = (value: number) => {
    const snapped = Math.round(value / stepSize()) * stepSize()
    return Math.min(Math.max(snapped, 0), maxValue())
  }

  const emitRange = (start: number, end: number) => {
    const nextStart = clampIndex(start)
    props.onChange([nextStart, Math.max(clampIndex(end), nextStart)])
  }

  return (
    <Slider
      class="fixed inset-y-0 left-6 z-50 my-auto h-lvh max-h-180 py-16"
      value={props.value}
      minValue={0}
      maxValue={maxValue()}
      step={stepSize()}
      orientation="vertical"
      inverted
      onChange={(values) => emitRange(values[0], values[1])}
      aria-label="表示期間"
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
          class="cursor-grab before:pointer-events-auto before:absolute before:inset-y-0 before:-right-16 before:-left-6 before:cursor-grab before:content-[''] active:cursor-grabbing active:before:cursor-grabbing"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return

            const trackHeight =
              event.currentTarget.parentElement?.getBoundingClientRect().height ?? 0
            if (trackHeight === 0) return

            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)

            const [startValue, endValue] = props.value
            rangeDrag = {
              pointerId: event.pointerId,
              pointerStartY: event.clientY,
              trackHeight,
              startValue,
              endValue,
            }
          }}
          onPointerMove={(event) => {
            if (rangeDrag?.pointerId !== event.pointerId) return

            event.preventDefault()
            event.stopPropagation()

            const rangeLength = rangeDrag.endValue - rangeDrag.startValue
            const indexDelta =
              Math.round(
                (((event.clientY - rangeDrag.pointerStartY) / rangeDrag.trackHeight) *
                  maxValue()) /
                  stepSize(),
              ) * stepSize()
            const nextStartValue = Math.min(
              Math.max(rangeDrag.startValue + indexDelta, 0),
              maxValue() - rangeLength,
            )
            if (props.value[0] === nextStartValue) return

            emitRange(nextStartValue, nextStartValue + rangeLength)
          }}
          onPointerUp={(event) => {
            if (rangeDrag?.pointerId !== event.pointerId) return

            event.stopPropagation()
            event.currentTarget.releasePointerCapture(event.pointerId)
            rangeDrag = undefined
          }}
          onPointerCancel={(event) => {
            if (rangeDrag?.pointerId !== event.pointerId) return

            event.stopPropagation()
            rangeDrag = undefined
          }}
        />
        <SliderThumb
          class={THUMB_CLASS}
          aria-label="開始時刻"
          aria-valuetext={formatTime(props.value[0])}
        >
          <span class={LABEL_CLASS}>{formatTime(props.value[0])}</span>
        </SliderThumb>
        <SliderThumb
          class={THUMB_CLASS}
          aria-label="終了時刻"
          aria-valuetext={formatTime(props.value[1])}
        >
          <span class={LABEL_CLASS}>{formatTime(props.value[1])}</span>
        </SliderThumb>
      </SliderTrack>
    </Slider>
  )
}
