import { commitBatch } from './store'
import type {
  Change,
  DatingEvidence,
  Evidence,
  Hypothesis,
  HypothesisLink,
  Locus,
  Relation,
} from './types'
import { uid } from './db'

/**
 * 示例工程：两个编号体系独立的探方（TG1 / TG2），
 * 含切割事件、孤立层位、互相矛盾的记录、测年证据，
 * 以及两个互不污染的跨探方关联假设：
 *   甲方案：TG2 灰烬层 ≈ TG1 文化层（年代兼容，可自洽）
 *   乙方案：同号对应（TG1·105 ≈ TG2·105 年代无交集；柱洞≈地面 成环）
 */
export async function loadSample() {
  const L = (
    trench: string,
    code: string,
    label: string,
    kind: Locus['kind'],
    note?: string,
  ): Locus => ({ id: `${trench}:${code}`, trench, code, label, kind, note })

  const loci: Locus[] = [
    // ---- TG1：主剖面探方 ----
    L('TG1', '101', '表土层', 'layer'),
    L('TG1', '102', '踩踏面', 'interface'),
    L('TG1', '103', '灰坑填土', 'fill'),
    L('TG1', '104', '灰坑（切割）', 'cut'),
    L('TG1', '105', '文化层', 'layer'),
    L('TG1', '106', '房址地面', 'interface'),
    L('TG1', '107', '柱洞填土', 'fill'),
    L('TG1', '108', '柱洞（切割）', 'cut'),
    L('TG1', '109', '生土层', 'layer'),
    L('TG1', '110', '探方外孤立层', 'layer', '未与主剖面建立关系'),
    L('TG1', '111', '扰坑填土', 'fill'),
    L('TG1', '112', '晚期扰坑（切割）', 'cut'),
    // ---- TG2：独立编号的邻方（同号不同层位：TG2:105 ≠ TG1:105） ----
    L('TG2', '101', '表土层', 'layer'),
    L('TG2', '102', '扰动层', 'layer'),
    L('TG2', '103', '灰烬层', 'layer'),
    L('TG2', '104', '踩踏硬面', 'interface'),
    L('TG2', '105', '文化层', 'layer', '与 TG1:105 同号但身份独立'),
    L('TG2', '106', '生土层', 'layer'),
  ]

  const rel = (
    from: string,
    to: string,
    layer: Relation['layer'],
    basis: string,
    status: Relation['status'] = 'active',
    kind: Relation['kind'] = 'stratigraphic',
  ): Relation => ({
    id: uid('r'),
    kind,
    from,
    to,
    layer,
    status,
    basis,
    createdAt: Date.now(),
  })

  const relations: Relation[] = [
    // TG1 主剖面
    rel('TG1:101', 'TG1:102', 'observation', '东壁剖面直接叠压'),
    rel('TG1:102', 'TG1:103', 'observation', '踩踏面压灰坑填土'),
    rel('TG1:103', 'TG1:104', 'observation', '填土晚于坑口（填充关系）'),
    rel('TG1:104', 'TG1:105', 'observation', '坑壁打破文化层（切割事件）'),
    rel('TG1:105', 'TG1:106', 'observation', '文化层压房址地面'),
    rel('TG1:106', 'TG1:109', 'observation', '地面下即生土'),
    rel('TG1:107', 'TG1:108', 'observation', '柱洞填土晚于柱洞（填充关系）'),
    rel('TG1:108', 'TG1:106', 'observation', '柱洞打破房址地面（切割事件）'),
    rel('TG1:111', 'TG1:112', 'observation', '扰坑填土晚于扰坑（填充关系）'),
    rel('TG1:112', 'TG1:101', 'observation', '扰坑打破表土层（切割事件）'),
    rel('TG1:102', 'TG1:104', 'inference', '由 102→103→104 传递推断'),
    rel('TG1:103', 'TG1:105', 'inference', '由 103→104→105 传递推断'),
    // 矛盾记录：与「105 叠压 106」直接冲突，仍留档备查
    rel('TG1:106', 'TG1:105', 'observation', '第3次记录写作“106压105”，疑为笔误', 'conflicted'),
    // 同期关联：不构成有向边
    rel('TG1:103', 'TG1:107', 'observation', '出土陶片纹饰一致，疑同期', 'active', 'association'),
    // TG2 剖面
    rel('TG2:101', 'TG2:102', 'observation', '南壁剖面叠压'),
    rel('TG2:102', 'TG2:103', 'observation', '扰动层压灰烬层'),
    rel('TG2:103', 'TG2:104', 'observation', '灰烬层压踩踏硬面'),
    rel('TG2:104', 'TG2:105', 'observation', '硬面压文化层'),
    rel('TG2:105', 'TG2:106', 'observation', '文化层下即生土'),
  ]

  const evidence: Evidence[] = [
    { id: uid('e'), relationId: relations[3].id, type: 'photo', text: '照片 TG1-东壁-034：坑壁切线清晰' },
    { id: uid('e'), relationId: relations[3].id, type: 'section', text: '剖面图 S-07 第4层被104打破' },
    { id: uid('e'), relationId: relations[4].id, type: 'note', text: '田野记录 6/12：105 整体压 106' },
    { id: uid('e'), relationId: relations[12].id, type: 'note', text: '田野记录 6/14 补记：106压105（与6/12矛盾）' },
    { id: uid('e'), relationId: relations[13].id, type: 'note', text: '陶片比对卡 T-22' },
  ]

  // ---- 测年证据：全库唯一一份，假设只引用 ----
  const dat = (
    locusId: string,
    bpEarly: number | null,
    bpLate: number | null,
    source: string,
    note?: string,
  ): DatingEvidence => ({
    id: uid('d'),
    locusId,
    bpEarly,
    bpLate,
    source,
    note,
    createdAt: Date.now(),
  })
  const dating: DatingEvidence[] = [
    dat('TG1:105', 3300, 3100, 'BETA-5501', '炭样 ¹⁴C（文化层中部）'),
    dat('TG2:103', 3280, 3050, 'BETA-5517', '炭样 ¹⁴C（灰烬层）'),
    dat('TG2:105', 3600, 3400, 'TL-088', '陶片热释光'),
    dat('TG1:109', 12000, 6000, 'OSL-012', '生土顶面光释光'),
  ]

  // ---- 两个互不污染的关联假设 ----
  const h1: Hypothesis = {
    id: uid('h'),
    name: '甲方案：灰烬层≈文化层',
    note: '按炭样年代重叠对应',
    createdAt: Date.now(),
  }
  const h2: Hypothesis = {
    id: uid('h'),
    name: '乙方案：同号对应',
    note: '按编号机械对应（用于检验）',
    createdAt: Date.now(),
  }
  const link = (
    hypothesisId: string,
    members: string[],
    note: string,
  ): HypothesisLink => ({
    id: uid('hl'),
    hypothesisId,
    members: [...members].sort(),
    note,
    createdAt: Date.now(),
  })
  const h1Links = [
    link(h1.id, ['TG1:105', 'TG2:103'], '炭样区间重叠'),
    link(h1.id, ['TG1:106', 'TG2:104'], '均为踩踏面'),
  ]
  const h2Links = [
    link(h2.id, ['TG1:105', 'TG2:105'], '同号对应 → 年代无交集'),
    link(h2.id, ['TG1:108', 'TG1:106'], '假定柱洞与地面同期 → 成环'),
  ]

  const changes: Change[] = [
    ...loci.map((locus): Change => ({ type: 'add-locus', locus })),
    ...relations.map((relation): Change => ({
      type: 'add-relation',
      relation,
      evidence: evidence.filter((e) => e.relationId === relation.id),
    })),
    ...dating.map((d): Change => ({ type: 'add-dating', dating: d })),
    { type: 'add-hypothesis', hypothesis: h1, links: h1Links },
    { type: 'add-hypothesis', hypothesis: h2, links: h2Links },
  ]
  await commitBatch('载入示例工程（双探方/切割/孤立层/矛盾/测年/假设）', changes)
}
