import { db } from './db'
import { buildGraph, orderDigest } from './graph/stratigraphy'
import { reload, state } from './store'
import type { ProjectExport } from './types'

/** 导出为单个 JSON 文件；附带偏序摘要供导入端校验。 */
export async function exportProject(): Promise<string> {
  const [loci, relations, evidence, revocations, positions] = await Promise.all([
    db.loci.toArray(),
    db.relations.toArray(),
    db.evidence.toArray(),
    db.revocations.toArray(),
    db.positions.toArray(),
  ])
  const payload: ProjectExport = {
    format: 'harris-matrix-export',
    version: 1,
    exportedAt: Date.now(),
    loci,
    relations,
    evidence,
    revocations,
    positions,
    orderDigest: orderDigest(buildGraph(relations)),
  }
  return JSON.stringify(payload, null, 2)
}

export interface ImportResult {
  ok: boolean
  error?: string
  /** 导入前后偏序摘要是否一致 */
  orderPreserved?: boolean
  counts?: { loci: number; relations: number; evidence: number }
}

/** 导入：整体替换当前工程，并重算偏序摘要与文件内摘要比对。 */
export async function importProject(json: string): Promise<ImportResult> {
  let data: ProjectExport
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' }
  }
  if (data?.format !== 'harris-matrix-export' || data.version !== 1) {
    return { ok: false, error: '文件格式或版本不受支持' }
  }
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
      await db.loci.bulkAdd(data.loci)
      await db.relations.bulkAdd(data.relations)
      await db.evidence.bulkAdd(data.evidence)
      await db.revocations.bulkAdd(data.revocations)
      await db.positions.bulkAdd(data.positions)
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
    },
  }
}
