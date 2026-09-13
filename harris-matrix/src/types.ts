// 领域类型：地层身份与画布位置分离；原始观察 / 推断 / 被撤销判断分层保存。

/** 层位（context）身份。不含任何画布坐标。
 *  编号体系按探方独立：id = `${trench}:${code}`，
 *  不同探方可以有相同 code（同号不同层位）。 */
export interface Locus {
  id: string
  trench: string
  code: string
  label: string
  kind: 'layer' | 'cut' | 'fill' | 'interface' | 'other'
  note?: string
}

/** 画布位置，单独一张表，仅按层位 id 关联。 */
export interface Position {
  id: string // locus id
  x: number
  y: number
}

export type RelationLayer = 'observation' | 'inference'
export type RelationStatus = 'active' | 'conflicted' | 'revoked'
/**
 * stratigraphic: 有向先后关系（叠压 / 切割 / 填充），from 晚于 to。
 * association:   同期关联，无方向，绝不进入有向图。
 */
export type RelationKind = 'stratigraphic' | 'association'

export interface Relation {
  id: string
  kind: RelationKind
  from: string
  to: string
  layer: RelationLayer
  status: RelationStatus
  basis?: string // 判断依据（层位关系描述）
  createdAt: number
  batchId?: string
}

/** 证据，挂在关系上；随关系一起被撤销/恢复。 */
export interface Evidence {
  id: string
  relationId: string
  type: 'photo' | 'note' | 'section' | 'plan'
  text: string
}

/** 被撤销的判断单独成表，原关系行只改状态、不删除。 */
export interface Revocation {
  id: string
  relationId: string
  reason: string
  at: number
  batchId?: string
}

// ---------- 测年证据（全库唯一一份，只被引用、从不复制） ----------

/**
 * 一条测年证据：某层位的年代界限。
 * 统一数值年代轴为 cal BP；bpEarly 为最早端（数值大），bpLate 为最晚端（数值小）。
 * 未知端点为 null，绝不用 0 代替。
 */
export interface DatingEvidence {
  id: string
  locusId: string
  bpEarly: number | null
  bpLate: number | null
  source: string // 实验室编号 / 样品号 / 文献
  note?: string
  createdAt: number
}

// ---------- 跨探方关联假设（与共同底稿隔离，只读试算，不写回） ----------

export interface Hypothesis {
  id: string
  name: string
  note?: string
  createdAt: number
}

/** 假设的一条关联项：把若干层位视为同时期。只存层位 id 引用。 */
export interface HypothesisLink {
  id: string
  hypothesisId: string
  members: string[]
  note?: string
  createdAt: number
}

// ---------- 批量操作与撤销 ----------

export type Change =
  | { type: 'add-relation'; relation: Relation; evidence: Evidence[] }
  | { type: 'status'; relationId: string; from: RelationStatus; to: RelationStatus }
  | { type: 'add-locus'; locus: Locus }
  | { type: 'add-evidence'; evidence: Evidence }
  | { type: 'add-dating'; dating: DatingEvidence }
  | { type: 'remove-dating'; dating: DatingEvidence }
  | { type: 'add-hypothesis'; hypothesis: Hypothesis; links: HypothesisLink[] }
  | { type: 'remove-hypothesis'; hypothesis: Hypothesis; links: HypothesisLink[] }
  | { type: 'add-link'; link: HypothesisLink }
  | { type: 'remove-link'; link: HypothesisLink }

export interface Batch {
  id: string
  label: string
  at: number
  undone: boolean
  changes: Change[]
}

// ---------- 导出格式 ----------

export interface ProjectExport {
  format: 'harris-matrix-export'
  version: 2
  exportedAt: number
  loci: Locus[]
  relations: Relation[]
  evidence: Evidence[]
  revocations: Revocation[]
  positions: Position[]
  dating: DatingEvidence[]
  hypotheses: Hypothesis[]
  hypothesisLinks: HypothesisLink[]
  /** 导出时活动有向关系的偏序摘要，导入后重算比对，验证偏序不变。 */
  orderDigest: string
}

export const KIND_LABEL: Record<Locus['kind'], string> = {
  layer: '堆积层',
  cut: '切割',
  fill: '填充',
  interface: '界面',
  other: '其他',
}

export const STATUS_LABEL: Record<RelationStatus, string> = {
  active: '有效',
  conflicted: '矛盾',
  revoked: '已撤销',
}

export const LAYER_LABEL: Record<RelationLayer, string> = {
  observation: '原始观察',
  inference: '推断',
}
