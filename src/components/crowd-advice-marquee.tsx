import { For, createMemo, onCleanup, onMount } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { createElementSize } from '@solid-primitives/resize-observer'
import { crowdRetryDelay, fetchCrowdAdvice, retryCrowdRequest } from '@/crowd'

const POLL_INTERVAL_MS = 10 * 60 * 1000
const TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

export default function CrowdAdviceMarquee() {
  let container!: HTMLDivElement
  let paragraph!: HTMLParagraphElement
  const containerSize = createElementSize(() => container)
  const paragraphSize = createElementSize(() => paragraph)
  const advice = createQuery(() => ({
    queryKey: ['crowd-advice'],
    queryFn: ({ signal }) => fetchCrowdAdvice(signal),
    staleTime: POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryCrowdRequest,
    retryDelay: crowdRetryDelay,
  }))
  const text = createMemo(() => advice.data?.advice
    ? `${TIME_FORMATTER.format(advice.data.generatedAt * 1000)}・${advice.data.advice}・`
    : '')
  // One extra paragraph covers the space exposed while the track moves left.
  const copies = createMemo(() => Array.from({
    length: paragraphSize.width
      ? Math.ceil((containerSize.width ?? 0) / paragraphSize.width) : 0,
  }, (_, index) => index))

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!advice.isFetching) void advice.refetch()
    }, POLL_INTERVAL_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <div ref={container} class="fixed inset-x-0 bottom-0 h-5 overflow-hidden bg-background text-base leading-5 text-foreground">
      <div
        class="flex w-max animate-crowd-advice motion-reduce:animate-none"
        style={{
          '--advice-offset': `${-(paragraphSize.width ?? 0)}px`,
          'animation-duration': `${(paragraphSize.width ?? 0) / 16}s`,
        }}
      >
        <p ref={paragraph} class="shrink-0 whitespace-nowrap">{text()}</p>
        <For each={copies()}>
          {() => <p class="shrink-0 whitespace-nowrap" aria-hidden="true">{text()}</p>}
        </For>
      </div>
    </div>
  )
}
