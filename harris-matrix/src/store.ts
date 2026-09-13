import { reactive } from 'vue'
import { db, uid } from './db'
import type {
  Batch,
  Change,
  DatingEvidence,
  Evidence,
  Hypothesis,
  HypothesisLink,
  Locus,
  Position,
  Relation,
  RelationKind,
  RelationLayer,
  RelationStatus,
  Revocation,
} from './types'
import { cyclePathIfAdded } from './graph/stratigraphy'

/** 全局状态：从 IndexedDB 载入后常驻内存，任何变更后整体刷新。 */
export const state = reactive({
  loci: [] as Locus[],
  relations: [] as Relation[],
  evidence: [] as Evidence[],
  revocations: [] as Revocation[],
  positions: [] as Position[],
  batches: [] as Batch[],
  dating: [] as DatingEvidence[],
  hypotheses: [] as Hypothesis[],
  hypothesisLinks: [] as HypothesisLink[],
  loaded: false,
})

export async function reload() {
  const [
    loci,
    relations,
    evidence,
    revocations,
    positions,
    batches,
    dating,
    hypotheses,
    hypothesisLinks,
  ] = await Promise.all([
    db.loci.toArray(),
    db.relations.toArray(),
    db.evidence.toArray(),
    db.revocations.toArray(),
    db.positions.toArray(),
    db.batches.orderBy('at').toArray(),
    db.dating.toArray(),
    db.hypotheses.toArray(),
    db.hypothesisLinks.toArray(),
  ])
  state.loci = loci
  state.relations = relations
  state.evidence = evidence
  state.revocations = revocations
  state.positions = positions
  state.batches = batches
  state.dating = dating
  state.hypotheses = hypotheses
  state.hypothesisLinks = hypothesisLinks
  state.loaded = true
}

export const evidenceOf = (relationId: string) =>
  state.evidence.filter((e) => e.relationId === relationId)

export const locusLabel = (id: string) =>
  state.loci.find((l) => l.id === id)?.label ?? id

/** 探方·编号 显示名（同号不同层位靠探方区分）。 */
export const locusName = (id: string) => {
  const l = state.loci.find((x) => x.id === id)
  return l ? `${l.trench}·${l.code}` : id
}

export const linksOfHypothesis = (hypothesisId: string) =>
  state.hypothesisLinks.filter((l) => l.hypothesisId === hypothesisId)

// ---------- 变更入口：一律以“批次”记录，保证可整体撤销 ----------

export async function commitBatch(label: string, changes: Change[]): Promise<Batch> {
  // 变更快照可能引用 Vue 响应式对象（Proxy），IndexedDB 无法克隆——
  // 一律深拷贝为纯数据后再入库、再入批次。
  const plain = JSON.parse(JSON.stringify(changes)) as Change[]
  const batch: Batch = { id: uid('b'), label, at: Date.now(), undone: false, changes: plain }
  await db.transaction(
    'rw',
    [
      db.loci,
      db.relations,
      db.evidence,
      db.revocations,
      db.batches,
      db.dating,
      db.hypotheses,
      db.hypothesisLinks,
    ],
    async () => {
      for (const c of plain) {
        switch (c.type) {
          case 'add-relation':
            await db.relations.add(c.relation)
            for (const ev of c.evidence) await db.evidence.add(ev)
            break
          case 'status':
            await db.relations.update(c.relationId, { status: c.to })
            if (c.to === 'revoked') {
              await db.revocations.add({
                id: uid('rev'),
                relationId: c.relationId,
                reason: '撤销判断',
                at: Date.now(),
                batchId: batch.id,
              })
            }
            break
          case 'add-locus':
            await db.loci.add(c.locus)
            break
          case 'add-evidence':
            await db.evidence.add(c.evidence)
            break
          case 'add-dating':
            await db.dating.add(c.dating)
            break
          case 'remove-dating':
            await db.dating.delete(c.dating.id)
            break
          case 'add-hypothesis':
            await db.hypotheses.add(c.hypothesis)
            for (const l of c.links) await db.hypothesisLinks.add(l)
            break
          case 'remove-hypothesis':
            await db.hypotheses.delete(c.hypothesis.id)
            await db.hypothesisLinks.bulkDelete(c.links.map((l) => l.id))
            break
          case 'add-link':
            await db.hypothesisLinks.add(c.link)
            break
          case 'remove-link':
            await db.hypothesisLinks.delete(c.link.id)
            break
        }
      }
      await db.batches.add(batch)
    },
  )
  await reload()
  return batch
}

export interface AddRelationResult {
  ok: boolean
  /** 成环时的完整环路径（节点 id 序列） */
  cycle?: string[]
  relation?: Relation
}

/**
 * 新增关系。
 * - 同期关联：直接保存，绝不进入有向图、不做成环检测。
 * - 有向关系：先做成环检测；成环则拒绝写入并返回环路径，
 *   由调用方决定是否以“矛盾记录”身份另行保存。
 */
export async function addRelation(input: {
  kind: RelationKind
  from: string
  to: string
  layer: RelationLayer
  basis?: string
  evidenceTexts?: string[]
  /** 成环时仍要保留为矛盾记录（考古上两条观察都要留档） */
  allowConflict?: boolean
}): Promise<AddRelationResult> {
  if (input.kind === 'stratigraphic') {
    const cycle = cyclePathIfAdded(state.relations, input.from, input.to)
    if (cycle && !input.allowConflict) return { ok: false, cycle: cycle ?? undefined }
    const status: RelationStatus = cycle ? 'conflicted' : 'active'
    const relation: Relation = {
      id: uid('r'),
      kind: input.kind,
      from: input.from,
      to: input.to,
      layer: input.layer,
      status,
      basis: input.basis,
      createdAt: Date.now(),
    }
    const evidence: Evidence[] = (input.evidenceTexts ?? [])
      .filter((t) => t.trim())
      .map((t) => ({
        id: uid('e'),
        relationId: relation.id,
        type: 'note' as const,
        text: t.trim(),
      }))
    await commitBatch(
      `新增${cycle ? '矛盾' : ''}关系 ${locusLabel(input.from)} → ${locusLabel(input.to)}`,
      [{ type: 'add-relation', relation, evidence }],
    )
    return { ok: true, cycle: cycle ?? undefined, relation }
  }
  // association：无方向，只存档
  const relation: Relation = {
    id: uid('r'),
    kind: 'association',
    from: input.from,
    to: input.to,
    layer: input.layer,
    status: 'active',
    basis: input.basis,
    createdAt: Date.now(),
  }
  await commitBatch(`新增同期关联 ${locusLabel(input.from)} ≈ ${locusLabel(input.to)}`, [
    { type: 'add-relation', relation, evidence: [] },
  ])
  return { ok: true, relation }
}

export async function addLocus(input: {
  trench: string
  code: string
  label: string
  kind: Locus['kind']
  note?: string
}) {
  const id = `${input.trench}:${input.code}`
  if (state.loci.some((l) => l.id === id)) {
    throw new Error(`层位 ${id} 已存在（同号不同层位请核对探方）`)
  }
  const locus: Locus = { ...input, id }
  await commitBatch(`新增层位 ${id}`, [{ type: 'add-locus', locus }])
}

/** 撤销/恢复单条判断（状态切换，记录永不删除）。 */
export async function setRelationStatus(
  relationId: string,
  to: RelationStatus,
  label?: string,
) {
  const r = state.relations.find((x) => x.id === relationId)
  if (!r || r.status === to) return
  await commitBatch(label ?? `判断 ${relationId} 置为 ${to}`, [
    { type: 'status', relationId, from: r.status, to },
  ])
}

/** 批量撤销一批矛盾/有效判断 —— 演示“批量操作可整体撤销”。 */
export async function bulkRevoke(relationIds: string[], label: string) {
  const changes: Change[] = []
  for (const id of relationIds) {
    const r = state.relations.find((x) => x.id === id)
    if (r && r.status !== 'revoked')
      changes.push({ type: 'status', relationId: id, from: r.status, to: 'revoked' })
  }
  if (changes.length) await commitBatch(label, changes)
}

/**
 * 撤销最近一个未撤销的批次：逆序回放反向操作。
 * 状态改回原值，新增的关系连同其证据引用一起移除——
 * 由于批次里保存了完整快照，撤销“撤销类批次”即等于把
 * 关系与证据引用一并恢复。
 */
export async function undoLastBatch(): Promise<Batch | null> {
  const candidate = [...state.batches].reverse().find((b) => !b.undone)
  if (!candidate) return null
  // 从库里取纯数据快照（state 中的响应式 Proxy 不能直接写回 IndexedDB）
  const batch = await db.batches.get(candidate.id)
  if (!batch) return null
  await db.transaction(
    'rw',
    [
      db.loci,
      db.relations,
      db.evidence,
      db.revocations,
      db.batches,
      db.dating,
      db.hypotheses,
      db.hypothesisLinks,
    ],
    async () => {
      for (const c of [...batch.changes].reverse()) {
        switch (c.type) {
          case 'add-relation':
            await db.evidence.bulkDelete(c.evidence.map((e) => e.id))
            await db.relations.delete(c.relation.id)
            break
          case 'status':
            await db.relations.update(c.relationId, { status: c.from })
            await db.revocations
              .where('relationId')
              .equals(c.relationId)
              .and((rev) => rev.batchId === batch.id)
              .delete()
            break
          case 'add-locus':
            await db.loci.delete(c.locus.id)
            break
          case 'add-evidence':
            await db.evidence.delete(c.evidence.id)
            break
          case 'add-dating':
            await db.dating.delete(c.dating.id)
            break
          case 'remove-dating':
            await db.dating.add(c.dating)
            break
          case 'add-hypothesis':
            await db.hypotheses.delete(c.hypothesis.id)
            await db.hypothesisLinks.bulkDelete(c.links.map((l) => l.id))
            break
          case 'remove-hypothesis':
            await db.hypotheses.add(c.hypothesis)
            for (const l of c.links) await db.hypothesisLinks.add(l)
            break
          case 'add-link':
            await db.hypothesisLinks.delete(c.link.id)
            break
          case 'remove-link':
            await db.hypothesisLinks.add(c.link)
            break
        }
      }
      await db.batches.update(batch.id, { undone: true })
    },
  )
  await reload()
  return batch
}

// ---------- 测年证据与关联假设 ----------

/** 补入测年证据。证据全库唯一一份，假设与矛盾只引用其 id。 */
export async function addDatingEvidence(input: {
  locusId: string
  bpEarly: number | null
  bpLate: number | null
  source: string
  note?: string
}) {
  if (input.bpEarly === null && input.bpLate === null)
    throw new Error('至少要给一个年代端点（未知端点留空即可）')
  if (
    input.bpEarly !== null &&
    input.bpLate !== null &&
    input.bpEarly <= input.bpLate
  )
    throw new Error('最早端（BP 大值）必须大于最晚端（BP 小值）')
  const dating: DatingEvidence = { ...input, id: uid('d'), createdAt: Date.now() }
  await commitBatch(
    `补入测年 ${input.source} → ${locusName(input.locusId)}`,
    [{ type: 'add-dating', dating }],
  )
}

export async function removeDatingEvidence(id: string) {
  const dating = state.dating.find((d) => d.id === id)
  if (!dating) return
  await commitBatch(`删除测年 ${dating.source}`, [
    { type: 'remove-dating', dating },
  ])
}

export async function createHypothesis(name: string, note?: string) {
  const hypothesis: Hypothesis = {
    id: uid('h'),
    name,
    note,
    createdAt: Date.now(),
  }
  await commitBatch(`新建假设「${name}」`, [
    { type: 'add-hypothesis', hypothesis, links: [] },
  ])
  return hypothesis
}

/** 删除假设：只删假设与其关联项，底稿关系、测年证据原样保留。 */
export async function deleteHypothesis(id: string) {
  const hypothesis = state.hypotheses.find((h) => h.id === id)
  if (!hypothesis) return
  const links = linksOfHypothesis(id)
  await commitBatch(`删除假设「${hypothesis.name}」`, [
    { type: 'remove-hypothesis', hypothesis, links },
  ])
}

export async function addHypothesisLink(
  hypothesisId: string,
  members: string[],
  note?: string,
) {
  if (members.length < 2) throw new Error('关联项至少包含两个层位')
  const link: HypothesisLink = {
    id: uid('hl'),
    hypothesisId,
    members: [...members].sort(),
    note,
    createdAt: Date.now(),
  }
  await commitBatch(`假设新增关联项 ${members.map(locusName).join(' ≈ ')}`, [
    { type: 'add-link', link },
  ])
}

export async function removeHypothesisLink(linkId: string) {
  const link = state.hypothesisLinks.find((l) => l.id === linkId)
  if (!link) return
  await commitBatch(`移除关联项 ${link.members.map(locusName).join(' ≈ ')}`, [
    { type: 'remove-link', link },
  ])
}

export async function savePosition(id: string, x: number, y: number) {  await db.positions.put({ id, x, y })
  const p = state.positions.find((q) => q.id === id)
  if (p) {
    p.x = x
    p.y = y
  } else {
    state.positions.push({ id, x, y })
  }
}

export async function clearAll() {
  await db.transaction(
    'rw',
    [
      db.loci,
      db.relations,
      db.evidence,
      db.revocations,
      db.positions,
      db.batches,
      db.dating,
      db.hypotheses,
      db.hypothesisLinks,
    ],
    async () => {
      await Promise.all([
        db.loci.clear(),
        db.relations.clear(),
        db.evidence.clear(),
        db.revocations.clear(),
        db.positions.clear(),
        db.batches.clear(),
        db.dating.clear(),
        db.hypotheses.clear(),
        db.hypothesisLinks.clear(),
      ])
    },
  )
  await reload()
}
