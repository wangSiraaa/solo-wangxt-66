import Dexie, { type Table } from 'dexie'
import type {
  Batch,
  Evidence,
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
  }
}

export const db = new HarrisDB()

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
