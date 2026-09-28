import type { TreemapDatum } from './components/hierarchy-treemap/layout'
import type { CrowdSample, CrowdTarget } from './crowd-series'

export function buildCrowdTreemapData(
  targets: CrowdTarget[],
  samples: ReadonlyMap<string, CrowdSample | undefined>,
): TreemapDatum[] {
  const nodes: TreemapDatum[] = [{ id: 'campus', name: 'SFC' }]
  for (const target of targets) {
    const data = samples.get(target.key)?.data
    const point = data?.status === 'available' ? data.point : undefined
    nodes.push({
      id: target.key,
      parentId: target.area === null ? 'campus' : target.building,
      name: target.area ?? target.building,
      label: target.label,
      value: Math.max(point?.estimatedPeople ?? 0, 1),
      valueLabel: point ? String(Math.round(point.estimatedPeople)) : '–',
      color: point?.seatUtilization == null ? 'hsl(215 10% 26%)'
        : `hsl(${(1 - Math.min(Math.max(point.seatUtilization, 0), 1)) * 130} 68% 41%)`,
    })
  }
  for (const building of nodes.filter((node) => node.parentId === 'campus')) {
    const floors = nodes.filter((node) => node.parentId === building.id)
    if (!floors.length) continue
    // Preserve each building's total area while dividing its interior by floor readings.
    // Parent totals are independent API readings, so do not add them to their children.
    if (samples.get(building.id)?.data?.status === 'available') {
      const floorWeight = floors.reduce((sum, floor) => sum + floor.value!, 0)
      for (const floor of floors) floor.value = floor.value! / floorWeight * building.value!
    }
    delete building.value
    delete building.color
  }
  return nodes
}
