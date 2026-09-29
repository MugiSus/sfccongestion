import type { TreemapDatum } from './components/hierarchy-treemap/layout'
import type { CrowdSample, CrowdTarget } from './crowd-series'

export function buildCrowdTreemapData(
  targets: CrowdTarget[],
  samples: ReadonlyMap<string, CrowdSample | undefined>,
): TreemapDatum[] {
  const nodes: TreemapDatum[] = [{ id: 'campus', name: 'SFC' }]
  for (const target of targets) {
    if (target.area === null) continue
    const data = samples.get(target.key)?.data
    const point = data?.status === 'ok' ? data : undefined
    if (point?.estimatedPeople === 0) continue
    nodes.push({
      id: target.key,
      parentId: target.building,
      name: target.area,
      label: target.label,
      value: point?.estimatedPeople ?? 1,
      valueLabel: point ? String(Math.round(point.estimatedPeople)) : '–',
      color: point?.seatUtilization == null ? 'hsl(215 10% 30%)'
        : `hsl(${(1 - Math.min(Math.max(point.seatUtilization, 0), 1)) * 130} 68% 41%)`,
    })
  }
  for (const building of targets.filter((target) => target.area === null)) {
    const areas = nodes.filter((node) => node.parentId === building.key)
    // Buildings are frames only; never leave one behind as a leaf when its areas are empty.
    if (!areas.length) continue
    const data = samples.get(building.key)?.data
    const point = data?.status === 'ok' ? data : undefined
    // Preserve each building's total area while dividing its interior by area readings.
    // Parent totals are independent API readings, so do not add them to their children.
    if (point) {
      const areaWeight = areas.reduce((sum, area) => sum + area.value!, 0)
      for (const area of areas) area.value = area.value! / areaWeight * Math.max(point.estimatedPeople, 1)
    }
    nodes.push({
      id: building.key,
      parentId: 'campus',
      name: building.building,
      label: building.label,
      valueLabel: point ? String(Math.round(point.estimatedPeople)) : '–',
    })
  }
  return nodes
}
