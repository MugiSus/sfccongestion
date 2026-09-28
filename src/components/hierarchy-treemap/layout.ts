import { stratify, treemap, treemapResquarify } from 'd3-hierarchy';

/**
 * D3で階層を組み立てるための1ノード。ルートは1つにします。
 */
export interface TreemapDatum {
  /** 配列全体で一意の識別子。 */
  id: string;
  /** 親ノードの識別子。ルートでは省略します。 */
  parentId?: string;
  /** 表示名とツールチップ内の経路に使う名前。 */
  name: string;
  /** 画面上の名前だけを上書きします。ツールチップにはnameを使います。 */
  label?: string;
  /** 末端の面積の重み。親では省略し、D3が子の合計を計算します。 */
  value?: number;
  /**
   * 表示値の上書き。省略時は合計値を表示します。
   * ゼロ・未取得でも場所を残す場合はvalueを1にし、'0'または'–'を指定します。
   */
  valueLabel?: string;
  /** 矩形の色。省略時、末端は灰色、見出しは深さに応じた背景色です。 */
  color?: string;
}

export const TREEMAP_PADDING = 3;

/** フラットな配列を階層化し、値の降順・同値ならid順に並べます。空配列も受け取れます。 */
export function buildTreemapHierarchy(data: TreemapDatum[]) {
  return stratify<TreemapDatum>()(
    data.length ? data : [{ id: 'root', name: '' }],
  )
    .sum((node) => node.value ?? 0)
    .sort(
      (a, b) =>
        (b.value ?? 0) - (a.value ?? 0) || a.data.id.localeCompare(b.data.id),
    );
}

/**
 * 画面ピクセル単位のレイアウトを作成します。
 * 隙間は2px、余白は3px、見出しは深さ1で20px、それ以降は16pxです。
 */
export function createTreemapLayout() {
  // Layout directly in screen pixels; only the scene's translation uses CSS transforms.
  return treemap<TreemapDatum>()
    .tile(treemapResquarify)
    .round(true)
    .paddingInner(2)
    .paddingOuter(TREEMAP_PADDING)
    .paddingTop((node) => {
      if (node.depth === 0 || node.x1 - node.x0 < 40 || node.y1 - node.y0 < 48)
        return TREEMAP_PADDING;
      return node.depth === 1 ? 20 : 16;
    });
}
