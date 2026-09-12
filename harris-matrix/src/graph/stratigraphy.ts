import Graph from 'graphology'
import type { Relation } from '../types'

/**
 * 有向图只由「有效（active）的有向先后关系」构成。
 * 同期关联（association）、矛盾记录、已撤销判断一律不进图。
 * 边方向：from（晚）→ to（早），即“from 叠压/切割 to”。
 */
export function buildGraph(relations: Relation[]): Graph {
  const g = new Graph({ type: 'directed', multi: false })
  for (const r of relations) {
    if (r.kind !== 'stratigraphic' || r.status !== 'active') continue
    if (!g.hasNode(r.from)) g.addNode(r.from)
    if (!g.hasNode(r.to)) g.addNode(r.to)
    if (!g.hasEdge(r.from, r.to)) g.addEdge(r.from, r.to)
  }
  return g
}

/** BFS 找一条 from → to 的路径，返回节点序列；不存在返回 null。 */
export function findPath(g: Graph, from: string, to: string): string[] | null {
  if (!g.hasNode(from) || !g.hasNode(to)) return null
  if (from === to) return [from]
  const prev = new Map<string, string>()
  const queue: string[] = [from]
  const seen = new Set<string>([from])
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === to) break
    g.forEachOutNeighbor(cur, (nb) => {
      if (!seen.has(nb)) {
        seen.add(nb)
        prev.set(nb, cur)
        queue.push(nb)
      }
    })
  }
  if (!seen.has(to)) return null
  const path = [to]
  while (path[0] !== from) path.unshift(prev.get(path[0])!)
  return path
}

/**
 * 新增先后关系 from→to 前的成环检测。
 * 若图中已存在 to →…→ from 的路径，则新边会闭合有向环，
 * 返回完整环路径（含新边），供界面定位具体路径。
 */
export function cyclePathIfAdded(
  relations: Relation[],
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from, from]
  const g = buildGraph(relations)
  const back = findPath(g, to, from)
  if (!back) return null
  return [...back, to] // from →…→ to →（新边）→ from 的完整环
}

/** 每个节点的可达集（不含自身），用于偏序摘要与传递边判定。 */
export function reachabilityMap(g: Graph): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>()
  g.forEachNode((node) => {
    const seen = new Set<string>()
    const queue = [...g.outNeighbors(node)]
    while (queue.length) {
      const cur = queue.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const nb of g.outNeighbors(cur)) queue.push(nb)
    }
    reach.set(node, seen)
  })
  return reach
}

/**
 * 传递约简：仅当存在另一条 from→…→to 的路径时，该直接边为传递边。
 * 只返回需要“隐藏”的边键，绝不删除任何关系记录。
 */
export function transitiveEdgeKeys(g: Graph): Set<string> {
  const hidden = new Set<string>()
  const reach = reachabilityMap(g)
  g.forEachEdge((_e, _a, source, target) => {
    for (const mid of g.outNeighbors(source)) {
      if (mid !== target && reach.get(mid)?.has(target)) {
        hidden.add(`${source}→${target}`)
        break
      }
    }
  })
  return hidden
}

/** 稳定偏序摘要：节点 → 排序后的可达集，序列化为可比对字符串。 */
export function orderDigest(g: Graph): string {
  const reach = reachabilityMap(g)
  const nodes = [...reach.keys()].sort()
  return nodes
    .map((n) => `${n}>{${[...reach.get(n)!].sort().join(',')}}`)
    .join('|')
}

/** 分层布局：按到汇点的最长路径定层（早的在下），层内按 id 排序，坐标确定。 */
export function layeredPositions(
  g: Graph,
  allIds: string[],
): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>()
  const visit = (n: string, stack: Set<string>): number => {
    if (depth.has(n)) return depth.get(n)!
    if (stack.has(n) || !g.hasNode(n)) return 0 // 防御：图外节点或异常环
    stack.add(n)
    let d = 0
    for (const nb of g.outNeighbors(n)) d = Math.max(d, visit(nb, stack) + 1)
    stack.delete(n)
    depth.set(n, d)
    return d
  }
  for (const id of allIds) visit(id, new Set())

  const byDepth = new Map<number, string[]>()
  for (const id of allIds) {
    const d = depth.get(id) ?? 0
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(id)
  }
  const pos = new Map<string, { x: number; y: number }>()
  for (const [d, ids] of byDepth) {
    ids.sort()
    ids.forEach((id, i) => {
      pos.set(id, {
        x: (i - (ids.length - 1) / 2) * 170,
        y: -d * 110, // 晚的在上，早的在下
      })
    })
  }
  return pos
}
