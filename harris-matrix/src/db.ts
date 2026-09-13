import Dexie, { type Table } from 'dexie'
import type {
  Batch,
  DatingEvidence,
  Evidence,
  Hypothesis,
  HypothesisLink,
  Locus,
  Position,
  Relation,
  Revocation,
} from './types'

/** 纯浏览器工程库：所有现场资料只进 IndexedDB，不发生任何网络上传。 */
export class HarrisDB extends Dexie {
  loci!: Table<Locus, string>
  relations!: Table<Relation, string>
  evidence!: Table<Evidence, string>
  revocations!: Table<Revocation, string>
  positions!: Table<Position, string>
  batches!: Table<Batch, string>
  dating!: Table<DatingEvidence, string>
  hypotheses!: Table<Hypothesis, string>
  hypothesisLinks!: Table<HypothesisLink, string>

  constructor() {
    super('harris-matrix')
    this.version(1).stores({
      loci: 'id',
      relations: 'id, status, layer, kind, batchId',
      evidence: 'id, relationId',
      revocations: 'id, relationId',
      positions: 'id',
      batches: 'id, at',
    })
    // v2：层位身份改为 trench:code；新增测年证据与关联假设表
    this.version(2)
      .stores({
        loci: 'id, trench',
        relations: 'id, status, layer, kind, batchId',
        evidence: 'id, relationId',
        revocations: 'id, relationId',
        positions: 'id',
        batches: 'id, at',
        dating: 'id, locusId',
        hypotheses: 'id',
        hypothesisLinks: 'id, hypothesisId',
      })
      .upgrade(async (tx) => {
        const lociTable = tx.table('loci')
        const oldLoci = await lociTable.toArray()
        if (!oldLoci.length || oldLoci[0].trench) return // 空库或已是新结构
        await lociTable.clear()
        await lociTable.bulkAdd(
          oldLoci.map((l: Locus & { id: string }) => ({
            ...l,
            trench: 'TG1',
            code: l.id,
            id: `TG1:${l.id}`,
          })),
        )
        const relTable = tx.table('relations')
        const rels = await relTable.toArray()
        await relTable.clear()
        await relTable.bulkAdd(
          rels.map((r: Relation) => ({
            ...r,
            from: `TG1:${r.from}`,
            to: `TG1:${r.to}`,
          })),
        )
        const posTable = tx.table('positions')
        const poss = await posTable.toArray()
        await posTable.clear()
        await posTable.bulkAdd(
          poss.map((p: Position) => ({ ...p, id: `TG1:${p.id}` })),
        )
      })
  }
}

export const db = new HarrisDB()

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
