import { buildGraph, findPath } from './stratigraphy'
import type {
  DatingEvidence,
  HypothesisLink,
  Locus,
  Relation,
} from '../types'

/**
 * 统一数值年代轴 t：t = −calBP，数值越大越晚。
 * 未知端点一律为 null，绝不用 0 代替。
 */
export interface Interval {
  lo: number | null // 下界（最早）：t ≥ lo ⟺ 不早于 −lo BP
  hi: number | null // 上界（最晚）：t ≤ hi ⟺ 不晚于 −hi BP
}

/** 界限来源：哪条测年证据、沿哪条路径传播而来。只存引用 id。 */
export interface Provenance {
  datingId: string | null
  originLocus: string
  route: string[] // 层位序列：证据所在层位 → … → 受影响层位
  relationIds: string[] // 传播跨过的先后关系
}

export interface LocusInterval extends Interval {
  loProv: Provenance | null
  hiProv: Provenance | null
}

/** 矛盾依据：全部由可复查的引用组成（关系 id / 关联项 id / 测年证据 id）。 */
export type EvidenceItem =
  | { kind: 'relation'; relationId: string; from: string; to: string }
  | { kind: 'path'; relationIds: string[]; path: string[] }
  | { kind: 'link'; linkId: string; members: string[] }
  | {
      kind: 'dating'
      datingId: string
      locusId: string
      bound: 'lo' | 'hi'
      bp: number
      route: string[]
    }

export interface Contradiction {
  /** 由内容决定的稳定 id：同样数据反复评估得到同样 id（可复现）。 */
  id: string
  type: 'cycle' | 'interval'
  summary: string
  items: EvidenceItem[]
}

export interface EvalResult {
  ok: boolean
  contradictions: Contradiction[]
  intervals: Map<string, LocusInterval>
  /** 阶段划分：Ph1 最早；无地层关系的孤立层位为 '—'。 */
  phases: Map<string, string>
}

export interface EvalInput {
  relations: Relation[]
  loci: Locus[]
  dating: DatingEvidence[]
  links: HypothesisLink[]
}

/** 区间格式化（BP 轴显示）；未知端点如实显示，不填 0。 */
export const fmtInterval = (iv: Interval): string => {
  if (iv.lo !== null && iv.hi !== null) return `${-iv.hi}–${-iv.lo} cal BP`
  if (iv.lo !== null) return `不早于 ${-iv.lo} cal BP`
  if (iv.hi !== null) return `不晚于 ${-iv.hi} cal BP`
  return '未知'
}

export const fmtDating = (d: DatingEvidence): string => {
  if (d.bpEarly !== null && d.bpLate !== null)
    return `${d.bpLate}–${d.bpEarly} cal BP`
  if (d.bpEarly !== null) return `不早于 ${d.bpEarly} cal BP`
  if (d.bpLate !== null) return `不晚于 ${d.bpLate} cal BP`
  return '未知'
}

/**
 * 评估一组关联假设对年代与阶段的影响。
 * 纯函数：只读底稿（relations / dating）与假设（links），不写回任何东西。
 * 同一输入永远得到同一输出（矛盾 id、传播路径、阶段号均可复现）。
 */
export function evaluateChronology(input: EvalInput): EvalResult {
  const g = buildGraph(input.relations)
  const contradictions: Contradiction[] = []

  // ---- 1. 用关联项做并查集：同组层位被视为同时期 ----
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (parent.get(c)!== c) {
      const n = parent.get(c)!
      parent.set(c, r)
      c = n
    }
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  for (const l of input.loci) parent.set(l.id, l.id)
  for (const link of input.links) {
    const members = link.members.filter((m) => parent.has(m))
    for (const m of members.slice(1)) union(members[0], m)
  }
  const compMembers = new Map<string, string[]>()
  for (const l of input.loci) {
    const r = find(l.id)
    if (!compMembers.has(r)) compMembers.set(r, [])
    compMembers.get(r)!.push(l.id)
  }
  const linksOfComp = (root: string) =>
    input.links.filter((l) =>
      l.members.some((m) => parent.has(m) && find(m) === root),
    )

  const activeEdges = input.relations.filter(
    (r) => r.kind === 'stratigraphic' && r.status === 'active',
  )
  const pathRelationIds = (path: string[]) => {
    const ids: string[] = []
    for (let i = 0; i + 1 < path.length; i++) {
      const rel = activeEdges.find(
        (r) => r.from === path[i] && r.to === path[i + 1],
      )
      if (rel) ids.push(rel.id)
    }
    return ids
  }

  // ---- 2. 成环检测（假设 + 底稿先后关系共同闭合的有向环） ----
  // 2a. 同一关联项内部：两个成员间已存在先后链
  for (const link of input.links) {
    const members = link.members.filter((m) => parent.has(m))
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const p =
          findPath(g, members[i], members[j]) ??
          findPath(g, members[j], members[i])
        if (p) {
          contradictions.push({
            id: `cyc:${link.id}:${p.join('>')}`,
            type: 'cycle',
            summary: `关联项把 ${members[i]} 与 ${members[j]} 视为同时期，但底稿存在先后链 ${p.join(' → ')}`,
            items: [
              { kind: 'link', linkId: link.id, members: [...members] },
              { kind: 'path', relationIds: pathRelationIds(p), path: p },
            ],
          })
        }
      }
    }
  }
  // 2b. 有向边两端落入同一关联组（跨多个关联项闭合）
  for (const r of activeEdges) {
    if (!parent.has(r.from) || !parent.has(r.to)) continue
    if (find(r.from) !== find(r.to)) continue
    const already = contradictions.some((c) =>
      c.items.some(
        (it) => it.kind === 'path' && it.relationIds.includes(r.id),
      ),
    )
    if (already) continue
    const root = find(r.from)
    const links = linksOfComp(root)
    if (!links.length) continue
    contradictions.push({
      id: `cycs:${r.id}`,
      type: 'cycle',
      summary: `先后关系 ${r.from} → ${r.to} 的两端被关联项视为同时期`,
      items: [
        ...links.map(
          (l): EvidenceItem => ({
            kind: 'link',
            linkId: l.id,
            members: [...l.members],
          }),
        ),
        { kind: 'relation', relationId: r.id, from: r.from, to: r.to },
      ],
    })
  }
  // 2c. 压缩后的组间图仍有环（多个关联项串联成环）
  interface CEdge {
    from: string
    to: string
    relationId: string
    edgeFrom: string
    edgeTo: string
  }
  const cedges: CEdge[] = []
  for (const r of activeEdges) {
    if (!parent.has(r.from) || !parent.has(r.to)) continue
    const cf = find(r.from)
    const ct = find(r.to)
    if (cf !== ct)
      cedges.push({
        from: cf,
        to: ct,
        relationId: r.id,
        edgeFrom: r.from,
        edgeTo: r.to,
      })
  }
  {
    const adj = new Map<string, CEdge[]>()
    for (const e of cedges) {
      if (!adj.has(e.from)) adj.set(e.from, [])
      adj.get(e.from)!.push(e)
    }
    const color = new Map<string, number>()
    const stack: CEdge[] = []
    let cycleEdges: CEdge[] | null = null
    const dfs = (u: string) => {
      if (cycleEdges) return
      color.set(u, 1)
      for (const e of adj.get(u) ?? []) {
        if (cycleEdges) return
        const c = color.get(e.to) ?? 0
        if (c === 0) {
          stack.push(e)
          dfs(e.to)
          stack.pop()
        } else if (c === 1) {
          const idx = stack.findIndex((s) => s.from === e.to)
          cycleEdges = [...stack.slice(idx < 0 ? 0 : idx), e]
        }
      }
      color.set(u, 2)
    }
    for (const root of compMembers.keys()) if (!color.get(root)) dfs(root)
    if (cycleEdges) {
      const edges: CEdge[] = cycleEdges
      const comps = [...new Set(edges.flatMap((e) => [e.from, e.to]))]
      const linkItems: EvidenceItem[] = input.links
        .filter((l) =>
          l.members.some((m) => parent.has(m) && comps.includes(find(m))),
        )
        .map((l) => ({ kind: 'link', linkId: l.id, members: [...l.members] }))
      contradictions.push({
        id: `cycx:${edges.map((e) => e.relationId).sort().join('+')}`,
        type: 'cycle',
        summary: `多个关联项与先后关系共同闭合成环（涉及 ${comps.length} 个关联组）`,
        items: [
          ...linkItems,
          ...edges.map(
            (e): EvidenceItem => ({
              kind: 'relation',
              relationId: e.relationId,
              from: e.edgeFrom,
              to: e.edgeTo,
            }),
          ),
        ],
      })
    }
  }
  const hasCycle = contradictions.some((c) => c.type === 'cycle')

  // ---- 3. 证据区间（t 轴；同一层位多条证据取交集） ----
  const evIv = new Map<
    string,
    {
      lo: number | null
      hi: number | null
      loEv: DatingEvidence | null
      hiEv: DatingEvidence | null
    }
  >()
  for (const l of input.loci)
    evIv.set(l.id, { lo: null, hi: null, loEv: null, hiEv: null })
  for (const d of input.dating) {
    const slot = evIv.get(d.locusId)
    if (!slot) continue
    if (d.bpEarly !== null) {
      const t = -d.bpEarly
      if (slot.lo === null || t > slot.lo) {
        slot.lo = t
        slot.loEv = d
      }
    }
    if (d.bpLate !== null) {
      const t = -d.bpLate
      if (slot.hi === null || t < slot.hi) {
        slot.hi = t
        slot.hiEv = d
      }
    }
  }

  // ---- 4. 关联组区间 = 成员区间交集（同时期 ⇒ 年代必须兼容） ----
  interface CompIv extends Interval {
    loProv: Provenance | null
    hiProv: Provenance | null
  }
  const compIv = new Map<string, CompIv>()
  for (const [root, members] of compMembers) {
    const iv: CompIv = { lo: null, hi: null, loProv: null, hiProv: null }
    for (const m of members) {
      const ev = evIv.get(m)!
      if (ev.lo !== null && (iv.lo === null || ev.lo > iv.lo)) {
        iv.lo = ev.lo
        iv.loProv = {
          datingId: ev.loEv?.id ?? null,
          originLocus: m,
          route: [m],
          relationIds: [],
        }
      }
      if (ev.hi !== null && (iv.hi === null || ev.hi < iv.hi)) {
        iv.hi = ev.hi
        iv.hiProv = {
          datingId: ev.hiEv?.id ?? null,
          originLocus: m,
          route: [m],
          relationIds: [],
        }
      }
    }
    compIv.set(root, iv)
  }

  const relById = new Map(input.relations.map((r) => [r.id, r]))
  const intervalContradiction = (root: string, iv: CompIv) => {
    const members = compMembers.get(root)!
    const items: EvidenceItem[] = []
    if (iv.loProv?.datingId)
      items.push({
        kind: 'dating',
        datingId: iv.loProv.datingId,
        locusId: iv.loProv.originLocus,
        bound: 'lo',
        bp: -iv.lo!,
        route: iv.loProv.route,
      })
    if (iv.hiProv?.datingId)
      items.push({
        kind: 'dating',
        datingId: iv.hiProv.datingId,
        locusId: iv.hiProv.originLocus,
        bound: 'hi',
        bp: -iv.hi!,
        route: iv.hiProv.route,
      })
    for (const l of linksOfComp(root))
      items.push({ kind: 'link', linkId: l.id, members: [...l.members] })
    for (const rid of [
      ...new Set([
        ...(iv.loProv?.relationIds ?? []),
        ...(iv.hiProv?.relationIds ?? []),
      ]),
    ]) {
      const r = relById.get(rid)
      if (r)
        items.push({ kind: 'relation', relationId: rid, from: r.from, to: r.to })
    }
    contradictions.push({
      id: `int:${[iv.loProv?.datingId, iv.hiProv?.datingId]
        .filter(Boolean)
        .sort()
        .join('+')}:${[...members].sort().join(',')}`,
      type: 'interval',
      summary: `${members.join('、')} 的年代区间无交集（不早于 ${-iv.lo!} BP 却又不晚于 ${-iv.hi!} BP）`,
      items,
    })
  }

  // 4a. 组内交集检查（成环时依然可算，照常报告）
  const flagged = new Set<string>()
  for (const [root, iv] of compIv) {
    if (iv.lo !== null && iv.hi !== null && iv.lo > iv.hi) {
      intervalContradiction(root, iv)
      flagged.add(root)
    }
  }

  // ---- 5. 沿地层 DAG 传播（有环则跳过传播，避免无意义结果） ----
  // lo（不早于）由早传向晚；hi（不晚于）由晚传向早。
  if (!hasCycle) {
    const topo = (edges: CEdge[], key: 'from' | 'to') => {
      // Kahn：按 key 指定的端点“先处理”排序（key='to' 则早端先、key='from' 则晚端先）
      const nodes = [...compMembers.keys()]
      const out = new Map<string, CEdge[]>()
      const indeg = new Map<string, number>()
      for (const n of nodes) indeg.set(n, 0)
      for (const e of edges) {
        const a = e[key] // 先处理的一端
        const b = key === 'from' ? e.to : e.from
        if (!out.has(a)) out.set(a, [])
        out.get(a)!.push(e)
        indeg.set(b, (indeg.get(b) ?? 0) + 1)
      }
      const queue = nodes.filter((n) => (indeg.get(n) ?? 0) === 0).sort()
      const order: string[] = []
      const seen = new Set(queue)
      while (queue.length) {
        const u = queue.shift()!
        order.push(u)
        for (const e of out.get(u) ?? []) {
          const b = key === 'from' ? e.to : e.from
          indeg.set(b, indeg.get(b)! - 1)
          if (indeg.get(b) === 0 && !seen.has(b)) {
            seen.add(b)
            queue.push(b)
          }
        }
      }
      return order
    }
    // lo 传播：先处理早的一端
    for (const u of topo(cedges, 'to')) {
      for (const e of cedges.filter((x) => x.to === u)) {
        const from = compIv.get(e.from)! // 晚
        const to = compIv.get(e.to)! // 早
        if (to.lo !== null && (from.lo === null || to.lo > from.lo)) {
          from.lo = to.lo
          from.loProv = {
            datingId: to.loProv?.datingId ?? null,
            originLocus: to.loProv?.originLocus ?? e.edgeTo,
            route: [...(to.loProv?.route ?? [e.edgeTo]), e.edgeFrom],
            relationIds: [...(to.loProv?.relationIds ?? []), e.relationId],
          }
        }
      }
    }
    // hi 传播：先处理晚的一端
    for (const u of topo(cedges, 'from')) {
      for (const e of cedges.filter((x) => x.from === u)) {
        const from = compIv.get(e.from)!
        const to = compIv.get(e.to)!
        if (from.hi !== null && (to.hi === null || from.hi < to.hi)) {
          to.hi = from.hi
          to.hiProv = {
            datingId: from.hiProv?.datingId ?? null,
            originLocus: from.hiProv?.originLocus ?? e.edgeFrom,
            route: [...(from.hiProv?.route ?? [e.edgeFrom]), e.edgeTo],
            relationIds: [...(from.hiProv?.relationIds ?? []), e.relationId],
          }
        }
      }
    }
    // 传播后再查一次交集
    for (const [root, iv] of compIv) {
      if (flagged.has(root)) continue
      if (iv.lo !== null && iv.hi !== null && iv.lo > iv.hi)
        intervalContradiction(root, iv)
    }
  }

  // ---- 6. 写回每个层位（组成员共享组区间） ----
  const intervals = new Map<string, LocusInterval>()
  for (const l of input.loci) {
    const iv = compIv.get(find(l.id))!
    const extend = (p: Provenance | null): Provenance | null =>
      p
        ? {
            ...p,
            route:
              p.route[p.route.length - 1] === l.id
                ? p.route
                : [...p.route, l.id],
          }
        : null
    intervals.set(l.id, {
      lo: iv.lo,
      hi: iv.hi,
      loProv: extend(iv.loProv),
      hiProv: extend(iv.hiProv),
    })
  }

  // ---- 7. 阶段划分：关联组按地层深度编号，Ph1 最早 ----
  const phases = new Map<string, string>()
  {
    const depth = new Map<string, number>()
    const adj = new Map<string, string[]>()
    const touched = new Set<string>()
    for (const e of cedges) {
      if (!adj.has(e.from)) adj.set(e.from, [])
      adj.get(e.from)!.push(e.to)
      touched.add(e.from)
      touched.add(e.to)
    }
    const visit = (u: string, stack: Set<string>): number => {
      if (depth.has(u)) return depth.get(u)!
      if (stack.has(u)) return 0 // 有环时防御
      stack.add(u)
      let d = 0
      for (const v of adj.get(u) ?? []) d = Math.max(d, visit(v, stack) + 1)
      stack.delete(u)
      depth.set(u, d)
      return d
    }
    for (const root of compMembers.keys()) visit(root, new Set())
    for (const l of input.loci) {
      const root = find(l.id)
      phases.set(
        l.id,
        !hasCycle && touched.has(root) ? `Ph${depth.get(root)! + 1}` : '—',
      )
    }
  }

  return {
    ok: contradictions.length === 0,
    contradictions,
    intervals,
    phases,
  }
}

// ---------- 两个假设的逐项比较 ----------

export interface PhaseRow {
  locusId: string
  phaseA: string
  phaseB: string
  changed: boolean
}

export interface HypothesisDiff {
  onlyA: HypothesisLink[]
  both: HypothesisLink[]
  onlyB: HypothesisLink[]
  phaseRows: PhaseRow[]
  contradictionsA: Contradiction[]
  contradictionsB: Contradiction[]
}

const linkKey = (l: HypothesisLink) => [...l.members].sort().join('|')

/** 逐项比较两个假设：关联项差异、每个层位的阶段归属差异、各自矛盾。 */
export function compareHypotheses(
  linksA: HypothesisLink[],
  linksB: HypothesisLink[],
  evalA: EvalResult,
  evalB: EvalResult,
  loci: Locus[],
): HypothesisDiff {
  const keysB = new Set(linksB.map(linkKey))
  const keysA = new Set(linksA.map(linkKey))
  return {
    onlyA: linksA.filter((l) => !keysB.has(linkKey(l))),
    both: linksA.filter((l) => keysB.has(linkKey(l))),
    onlyB: linksB.filter((l) => !keysA.has(linkKey(l))),
    phaseRows: loci.map((l) => {
      const phaseA = evalA.phases.get(l.id) ?? '—'
      const phaseB = evalB.phases.get(l.id) ?? '—'
      return { locusId: l.id, phaseA, phaseB, changed: phaseA !== phaseB }
    }),
    contradictionsA: evalA.contradictions,
    contradictionsB: evalB.contradictions,
  }
}
