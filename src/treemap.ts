import { stratify, treemap } from 'd3-hierarchy'

export interface WifiClient {
  accessPointName: string
  buildingKey?: string
}

export interface WifiSnapshot {
  measuredAt: string
  clients: WifiClient[]
}

export interface AccessPointNode {
  id: string
  parentId: string | undefined
  name: string
  kind: 'campus' | 'building' | 'floor' | 'ap'
  clients: number
}

export function buildAccessPointHierarchy(clients: WifiClient[]) {
  const nodes = new Map<string, AccessPointNode>()
  nodes.set('campus', {
    id: 'campus', parentId: undefined, name: 'SFC', kind: 'campus', clients: 0,
  })

  for (const client of clients) {
    const name = client.accessPointName
    const location = /^ap-(.+?)-(\d+f|b\d+|bf|rf)(?:-|$)/.exec(name)
    const building = client.buildingKey ?? location?.[1] ?? 'unknown'
    const floor = location?.[2] ?? '階不明'
    const buildingId = JSON.stringify([building])
    const floorId = JSON.stringify([building, floor])
    const apId = JSON.stringify([building, floor, name])

    if (!nodes.has(buildingId)) {
      nodes.set(buildingId, {
        id: buildingId, parentId: 'campus', name: building, kind: 'building', clients: 0,
      })
    }
    if (!nodes.has(floorId)) {
      nodes.set(floorId, {
        id: floorId, parentId: buildingId, name: floor, kind: 'floor', clients: 0,
      })
    }
    const ap = nodes.get(apId)
    if (ap) {
      ap.clients += 1
    } else {
      nodes.set(apId, {
        id: apId, parentId: floorId, name, kind: 'ap', clients: 1,
      })
    }
  }

  return stratify<AccessPointNode>()([...nodes.values()])
    .sum((node) => node.clients)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.id!.localeCompare(b.id!))
}

export const layoutAccessPoints = treemap<AccessPointNode>()
  .paddingInner(2)
  .paddingOuter(3)
  .paddingTop((node) => {
    if (node.depth === 0 || node.x1 - node.x0 < 40 || node.y1 - node.y0 < 48) return 3
    return node.depth === 1 ? 20 : 16
  })
