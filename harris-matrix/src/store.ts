import { reactive } from 'vue'
import { db, uid } from './db'
import type {
  Batch,
  Change,
  Evidence,
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
  loaded: false,
})

export async function reload() {
  const [loci, relations, evidence, revocations, positions, batches] =
    await Promise.all([
      db.loci.toArray(),
      db.relations.toArray(),
      db.evidence.toArray(),
      db.revocations.toArray(),
      db.positions.toArray(),
      db.batches.orderBy('at').toArray(),
    ])
  state.loci = loci
  state.relations = relations
  state.evidence = evidence
  state.revocations = revocations
  state.positions = positions
  state.batches = batches
  state.loaded = true
}

export const evidenceOf = (relationId: string) =>
  state.evidence.filter((e) => e.relationId === relationId)

export const locusLabel = (id: string) =>
  state.loci.find((l) => l.id === id)?.label ?? id

// ---------- 变更入口：一律以“批次”记录，保证可整体撤销 ----------

export async function commitBatch(label: string, changes: Change[]): Promise<Batch> {
  const batch: Batch = { id: uid('b'), label, at: Date.now(), undone: false, changes }
  await db.transaction(
    'rw',
    [db.loci, db.relations, db.evidence, db.revocations, db.batches],
    async () => {
      for (const c of changes) {
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

export async function addLocus(locus: Omit<Locus, 'id'> & { id: string }) {
  if (state.loci.some((l) => l.id === locus.id)) {
    throw new Error(`层位编号 ${locus.id} 已存在`)
  }
  await commitBatch(`新增层位 ${locus.id}`, [{ type: 'add-locus', locus }])
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
  const batch = [...state.batches].reverse().find((b) => !b.undone)
  if (!batch) return null
  await db.transaction(
    'rw',
    [db.loci, db.relations, db.evidence, db.revocations, db.batches],
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
        }
      }
      await db.batches.update(batch.id, { undone: true })
    },
  )
  await reload()
  return batch
}

export async function savePosition(id: string, x: number, y: number) {
  await db.positions.put({ id, x, y })
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
    [db.loci, db.relations, db.evidence, db.revocations, db.positions, db.batches],
    async () => {
      await Promise.all([
        db.loci.clear(),
        db.relations.clear(),
        db.evidence.clear(),
        db.revocations.clear(),
        db.positions.clear(),
        db.batches.clear(),
      ])
    },
  )
  await reload()
}
