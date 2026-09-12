import { commitBatch } from './store'
import type { Change, Evidence, Locus, Relation } from './types'
import { uid } from './db'

/**
 * 示例工程：一个含切割事件、孤立层位与互相矛盾记录的探方。
 *
 * 地层故事（晚 → 早）：
 *   112 扰坑切割 101；111 为扰坑填土
 *   101 表土 → 102 踩踏面 → 103 灰坑填土 →(填充) 104 灰坑(切割) → 105 文化层
 *   105 → 106 房址地面 → 109 生土
 *   107 柱洞填土 →(填充) 108 柱洞(切割) → 106
 *   110 为探方外的孤立层位，无任何关系
 *   矛盾：观察记录同时存在「105 叠压 106」与「106 叠压 105」（后者留档为矛盾）
 *   同期：103 ≈ 107（出土物相似，仅为关联，不作有向边）
 */
export async function loadSample() {
  const loci: Locus[] = [
    { id: '101', label: '表土层', kind: 'layer' },
    { id: '102', label: '踩踏面', kind: 'interface' },
    { id: '103', label: '灰坑填土', kind: 'fill' },
    { id: '104', label: '灰坑（切割）', kind: 'cut' },
    { id: '105', label: '文化层', kind: 'layer' },
    { id: '106', label: '房址地面', kind: 'interface' },
    { id: '107', label: '柱洞填土', kind: 'fill' },
    { id: '108', label: '柱洞（切割）', kind: 'cut' },
    { id: '109', label: '生土层', kind: 'layer' },
    { id: '110', label: '探方外孤立层', kind: 'layer', note: '未与主剖面建立关系' },
    { id: '111', label: '扰坑填土', kind: 'fill' },
    { id: '112', label: '晚期扰坑（切割）', kind: 'cut' },
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
    rel('101', '102', 'observation', '东壁剖面直接叠压'),
    rel('102', '103', 'observation', '踩踏面压灰坑填土'),
    rel('103', '104', 'observation', '填土晚于坑口（填充关系）'),
    rel('104', '105', 'observation', '坑壁打破文化层（切割事件）'),
    rel('105', '106', 'observation', '文化层压房址地面'),
    rel('106', '109', 'observation', '地面下即生土'),
    rel('107', '108', 'observation', '柱洞填土晚于柱洞（填充关系）'),
    rel('108', '106', 'observation', '柱洞打破房址地面（切割事件）'),
    rel('111', '112', 'observation', '扰坑填土晚于扰坑（填充关系）'),
    rel('112', '101', 'observation', '扰坑打破表土层（切割事件）'),
    // 推断关系：由 102→103→104 与 103→104→105 传递得出，单独标注
    rel('102', '104', 'inference', '由 102→103→104 传递推断'),
    rel('103', '105', 'inference', '由 103→104→105 传递推断'),
    // 矛盾记录：与「105 叠压 106」直接冲突，仍留档备查
    rel('106', '105', 'observation', '第3次记录写作“106压105”，疑为笔误', 'conflicted'),
    // 同期关联：不构成有向边
    rel('103', '107', 'observation', '出土陶片纹饰一致，疑同期', 'active', 'association'),
  ]

  const evidence: Evidence[] = [
    { id: uid('e'), relationId: relations[3].id, type: 'photo', text: '照片 TG1-东壁-034：坑壁切线清晰' },
    { id: uid('e'), relationId: relations[3].id, type: 'section', text: '剖面图 S-07 第4层被104打破' },
    { id: uid('e'), relationId: relations[4].id, type: 'note', text: '田野记录 6/12：105 整体压 106' },
    { id: uid('e'), relationId: relations[12].id, type: 'note', text: '田野记录 6/14 补记：106压105（与6/12矛盾）' },
    { id: uid('e'), relationId: relations[13].id, type: 'note', text: '陶片比对卡 T-22' },
  ]

  const changes: Change[] = [
    ...loci.map((locus): Change => ({ type: 'add-locus', locus })),
    ...relations.map((relation): Change => ({
      type: 'add-relation',
      relation,
      evidence: evidence.filter((e) => e.relationId === relation.id),
    })),
  ]
  await commitBatch('载入示例工程（含切割/孤立层/矛盾记录）', changes)
}
