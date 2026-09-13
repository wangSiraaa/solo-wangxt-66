import { db } from './db'
import { buildGraph, orderDigest } from './graph/stratigraphy'
import { reload, state } from './store'
import type { ProjectExport } from './types'

/** 导出为单个 JSON 文件；附带偏序摘要供导入端校验。 */
export async function exportProject(): Promise<string> {
  const [
    loci,
    relations,
    evidence,
    revocations,
    positions,
    dating,
    hypotheses,
    hypothesisLinks,
  ] = await Promise.all([
    db.loci.toArray(),
    db.relations.toArray(),
    db.evidence.toArray(),
    db.revocations.toArray(),
    db.positions.toArray(),
    db.dating.toArray(),
    db.hypotheses.toArray(),
    db.hypothesisLinks.toArray(),
  ])
  const payload: ProjectExport = {
    format: 'harris-matrix-export',
    version: 2,
    exportedAt: Date.now(),
    loci,
    relations,
    evidence,
    revocations,
    positions,
    dating,
    hypotheses,
    hypothesisLinks,
    orderDigest: orderDigest(buildGraph(relations)),
  }
  return JSON.stringify(payload, null, 2)
}

export interface ImportResult {
  ok: boolean
  error?: string
  /** 导入前后偏序摘要是否一致 */
  orderPreserved?: boolean
  counts?: { loci: number; relations: number; evidence: number; dating: number }
}

/** v1 文件（无探方维度）升级为 v2：所有 id 归入 TG1。 */
function migrateV1(data: Record<string, unknown>): ProjectExport {
  const pre = (id: string) => `TG1:${id}`
  return {
    format: 'harris-matrix-export',
    version: 2,
    exportedAt: (data.exportedAt as number) ?? Date.now(),
    loci: ((data.loci as { id: string }[]) ?? []).map((l) => ({
      ...(l as object),
      trench: 'TG1',
      code: l.id,
      id: pre(l.id),
    })) as ProjectExport['loci'],
    relations: ((data.relations as { from: string; to: string }[]) ?? []).map(
      (r) => ({ ...(r as object), from: pre(r.from), to: pre(r.to) }),
    ) as ProjectExport['relations'],
    evidence: (data.evidence as ProjectExport['evidence']) ?? [],
    revocations: (data.revocations as ProjectExport['revocations']) ?? [],
    positions: ((data.positions as { id: string }[]) ?? []).map((p) => ({
      ...(p as object),
      id: pre(p.id),
    })) as ProjectExport['positions'],
    dating: [],
    hypotheses: [],
    hypothesisLinks: [],
    orderDigest: (data.orderDigest as string) ?? '',
  }
}

/** 导入：整体替换当前工程，并重算偏序摘要与文件内摘要比对。 */
export async function importProject(json: string): Promise<ImportResult> {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' }
  }
  if (raw?.format !== 'harris-matrix-export') {
    return { ok: false, error: '文件格式不受支持' }
  }
  const data =
    raw.version === 2
      ? (raw as unknown as ProjectExport)
      : raw.version === 1
        ? migrateV1(raw)
        : null
  if (!data) return { ok: false, error: '文件版本不受支持' }

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
      await db.loci.bulkAdd(data.loci)
      await db.relations.bulkAdd(data.relations)
      await db.evidence.bulkAdd(data.evidence)
      await db.revocations.bulkAdd(data.revocations)
      await db.positions.bulkAdd(data.positions)
      await db.dating.bulkAdd(data.dating)
      await db.hypotheses.bulkAdd(data.hypotheses)
      await db.hypothesisLinks.bulkAdd(data.hypothesisLinks)
    },
  )
  await reload()
  const after = orderDigest(buildGraph(state.relations))
  return {
    ok: true,
    orderPreserved: after === data.orderDigest,
    counts: {
      loci: data.loci.length,
      relations: data.relations.length,
      evidence: data.evidence.length,
      dating: data.dating.length,
    },
  }
}
