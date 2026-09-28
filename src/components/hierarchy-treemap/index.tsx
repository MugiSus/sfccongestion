import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type { JSX } from 'solid-js';
import {
  buildTreemapHierarchy,
  createTreemapLayout,
  TREEMAP_PADDING,
  type TreemapDatum,
} from './layout';
import './styles.css';

export type { TreemapDatum } from './layout';

interface HierarchyTreemapProps {
  /** ルートが1つの階層データ。通信は呼び出し元で行います。 */
  data: TreemapDatum[];
  /** 配置と大きさを指定するクラス。省略時は親要素の幅と高さを使います。 */
  class?: string;
  /** ツリーマップ全体のアクセシブルな名前。 */
  ariaLabel?: string;
  /** ステータス表示などをツリーマップに重ねるスロット。 */
  children?: JSX.Element;
}

const LABEL_PADDING = 8;
const LABEL_MIN_SIZE = 10;
const LABEL_MAX_SIZE = 32;
const HEADER_SIZE = 12;

/**
 * JSON配列を描画するSolidJSとD3の階層ツリーマップ。
 *
 * @remarks
 * sfc-wifi-treemapとsfccongestionで共通の描画に使用します。
 * 親要素内で使う場合は親に高さを指定してください。ResizeObserverで大きさを取得します。
 * D3のホイール・ドラッグ・ピンチ操作と1〜64倍のズームに対応します。
 * 見出し文字は12px、末端文字は10〜32px、末端の文字余白は8pxです。
 * solid-js、d3-hierarchy、d3-selection、d3-zoomとTailwind CSSを使用します。
 *
 * @example
 * ```tsx
 * import HierarchyTreemap, { type TreemapDatum } from './components/hierarchy-treemap';
 *
 * const data: TreemapDatum[] = [
 *   { id: 'root', name: 'SFC' },
 *   { id: 'kappa', parentId: 'root', name: 'kappa', label: 'Kappa' },
 *   { id: 'kappa/1f', parentId: 'kappa', name: '1f' },
 *   { id: 'kappa/1f/ap-1', parentId: 'kappa/1f', name: 'ap-1', value: 12, color: '#389b21' },
 * ];
 *
 * <HierarchyTreemap data={data} class="fixed inset-0" ariaLabel="接続端末数" />;
 * ```
 */
export default function HierarchyTreemap(props: HierarchyTreemapProps) {
  let container!: HTMLElement;
  const measurement = document.createElement('canvas').getContext('2d')!;
  let viewSize = { width: 0, height: 0 };
  const [fontFamily, setFontFamily] = createSignal('sans-serif');
  const [transform, setTransform] = createSignal(zoomIdentity);
  const scale = createMemo(() => transform().k);
  const [dragging, setDragging] = createSignal(false);
  const [viewport, setViewport] = createSignal(viewSize);
  const hierarchy = createMemo(() => buildTreemapHierarchy(props.data));
  const layoutNodes = createTreemapLayout();
  const layout = createMemo(() => {
    const { width, height } = viewport();
    if (width <= 0 || height <= 0) return [];
    return layoutNodes
      .size([width * scale(), height * scale()])(hierarchy())
      .descendants()
      .slice(1);
  });
  const nodeIds = createMemo(() => layout().map((node) => node.data.id));
  const nodes = createMemo(
    () => new Map(layout().map((node) => [node.data.id, node])),
  );

  onMount(() => {
    setFontFamily(getComputedStyle(container).fontFamily);
    let zoomFrame = 0;
    let endZoomFrame = 0;
    let pendingTransform = zoomIdentity;
    const surface = select(container);
    const navigation = zoom<HTMLElement, unknown>()
      .extent((): [[number, number], [number, number]] => [
        [0, 0],
        [viewSize.width, viewSize.height],
      ])
      .translateExtent([
        [0, 0],
        [viewSize.width, viewSize.height],
      ])
      .scaleExtent([1, 64])
      .on('start', () => {
        cancelAnimationFrame(endZoomFrame);
        setDragging(true);
      })
      .on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
        pendingTransform = event.transform;
        if (zoomFrame) return;
        zoomFrame = requestAnimationFrame(() => {
          zoomFrame = 0;
          setTransform(pendingTransform);
        });
      })
      .on('end', () => {
        // Paint the final zoom layout before restoring data-update transitions.
        endZoomFrame = requestAnimationFrame(() => {
          endZoomFrame = requestAnimationFrame(() => {
            endZoomFrame = 0;
            setDragging(false);
          });
        });
      });
    surface.call(navigation);

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      viewSize = { width, height };
      setViewport(viewSize);
      navigation.translateExtent([
        [0, 0],
        [width, height],
      ]);
      surface.call((selection) => navigation.scaleBy(selection, 1));
    });
    resize.observe(container);

    onCleanup(() => {
      cancelAnimationFrame(zoomFrame);
      cancelAnimationFrame(endZoomFrame);
      surface.on('.zoom', null);
      resize.disconnect();
    });
  });

  return (
    <main
      ref={container}
      class={`hierarchy-treemap touch-none overflow-hidden bg-background text-white select-none ${props.class ?? 'relative size-full'}`}
      classList={{ 'cursor-grab': !dragging(), 'cursor-grabbing': dragging() }}
      aria-label={props.ariaLabel}
    >
      <div
        class='treemap-scene absolute inset-0'
        classList={{ 'is-zooming': dragging() }}
        style={{
          transform: `translate(${transform().x}px, ${transform().y}px)`,
          '--label-padding': `${LABEL_PADDING}px`,
        }}
      >
        <For each={nodeIds()}>
          {(id) => {
            const node = () => nodes().get(id)!;
            const isLeaf = createMemo(() => !node().children?.length);
            const valueLabel = createMemo(
              () => node().data.valueLabel ?? String(node().value ?? 0),
            );
            const width = () => node().x1 - node().x0;
            const height = () => node().y1 - node().y0;
            const name = createMemo(
              () => node().data.label ?? node().data.name,
            );
            const title = () =>
              `${node()
                .ancestors()
                .reverse()
                .slice(1)
                .map((part) => part.data.name)
                .join(' / ')} · ${valueLabel()}`;
            const header = createMemo(() => `${name()} · ${valueLabel()}`);
            const textWidth = createMemo(() => {
              measurement.font = `600 ${LABEL_MAX_SIZE}px ${fontFamily()}`;
              const nameWidth = measurement.measureText(
                isLeaf() ? name() : header(),
              ).width;
              measurement.font = `400 ${LABEL_MAX_SIZE}px ${fontFamily()}`;
              const countWidth = measurement.measureText(valueLabel()).width;
              return isLeaf() ? Math.max(nameWidth, countWidth) : nameWidth;
            });
            const visible = createMemo(() => {
              const { x, y } = transform();
              const current = node();
              return (
                current.x1 + x > 0 &&
                current.x0 + x < viewport().width &&
                current.y1 + y > 0 &&
                current.y0 + y < viewport().height
              );
            });
            const headerHeight = () =>
              (node().children?.[0]?.y0 ?? node().y0) -
              node().y0 -
              TREEMAP_PADDING;
            const fontSize = createMemo(() => {
              if (!visible()) return 0;
              if (!isLeaf())
                return headerHeight() >= HEADER_SIZE && width() > 8
                  ? HEADER_SIZE
                  : 0;
              const availableWidth = width() - LABEL_PADDING * 2;
              const availableHeight = height() - LABEL_PADDING * 2;
              const lineHeight = 2.3;
              if (
                availableWidth <= 0 ||
                availableHeight < LABEL_MIN_SIZE * lineHeight
              )
                return 0;
              // Use whole screen pixels so DOM styles change only when the size does.
              return Math.max(
                LABEL_MIN_SIZE,
                Math.floor(
                  Math.min(
                    LABEL_MAX_SIZE,
                    (0.85 * availableWidth * LABEL_MAX_SIZE) / textWidth(),
                    availableHeight / lineHeight,
                  ),
                ),
              );
            });

            return (
              <div
                class='treemap-cell cell-transition absolute overflow-hidden'
                classList={{ 'flex items-center justify-center': isLeaf() }}
                title={title()}
                role={isLeaf() ? 'img' : undefined}
                aria-label={isLeaf() ? title() : undefined}
                style={{
                  left: `${node().x0}px`,
                  top: `${node().y0}px`,
                  width: `${width()}px`,
                  height: `${height()}px`,
                  'background-color':
                    node().data.color ??
                    (isLeaf()
                      ? 'hsl(215 10% 26%)'
                      : node().depth === 1
                        ? '#1d232b'
                        : '#303741'),
                }}
              >
                <Show when={fontSize()}>
                  {(size) => (
                    <div
                      class='treemap-label w-full'
                      classList={{
                        'text-center leading-[1.15]': isLeaf(),
                        'flex items-center leading-none': !isLeaf(),
                      }}
                      style={{
                        '--label-size': `${size()}px`,
                        height: isLeaf()
                          ? undefined
                          : `${headerHeight() + TREEMAP_PADDING}px`,
                      }}
                    >
                      <div class='truncate font-semibold'>
                        {isLeaf() ? name() : header()}
                      </div>
                      <Show when={isLeaf()}>
                        <div class='truncate opacity-85'>{valueLabel()}</div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      {props.children}
    </main>
  );
}
