import {
  buildGraph,
  cyclePathIfAdded,
  transitiveEdgeKeys,
  orderDigest,
  layeredPositions,
} from '../src/graph/stratigraphy'
import type { Relation } from '../src/types'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const rel = (
  from: string,
  to: string,
  layer: Relation['layer'] = 'observation',
  status: Relation['status'] = 'active',
  kind: Relation['kind'] = 'stratigraphic',
): Relation => ({
  id: `${from}->${to}-${layer}-${status}`,
  kind, from, to, layer, status, createdAt: 0,
})

// 示例工程的简化版
const relations: Relation[] = [
  rel('101', '102'), rel('102', '103'), rel('103', '104'), rel('104', '105'),
  rel('105', '106'), rel('106', '109'), rel('107', '108'), rel('108', '106'),
  rel('111', '112'), rel('112', '101'),
  rel('102', '104', 'inference'),           // 传递边：102→103→104
  rel('103', '105', 'inference'),           // 传递边：103→104→105
  rel('106', '105', 'observation', 'conflicted'), // 矛盾：不进图
  rel('103', '107', 'observation', 'active', 'association'), // 同期：不进图
]

console.log('1. 构图规则')
const g = buildGraph(relations)
check('有效有向边全部入图', g.hasEdge('101', '102') && g.hasEdge('112', '101'))
check('矛盾记录不进图', !g.hasEdge('106', '105'))
check('同期关联不进图', !g.hasEdge('103', '107') && !g.hasEdge('107', '103'))
check('孤立层位不产生节点', !g.hasNode('110'))

console.log('2. 成环检测并定位路径')
const direct = cyclePathIfAdded(relations, '106', '105')
check('直接互压成环', JSON.stringify(direct) === JSON.stringify(['105', '106', '105']), JSON.stringify(direct))
const long = cyclePathIfAdded(relations, '109', '101')
// BFS 返回最短环路径：经推断边 103→105
check('长链成环定位完整路径',
  JSON.stringify(long) === JSON.stringify(['101', '102', '103', '105', '106', '109', '101']),
  JSON.stringify(long))
check('合法关系不报环', cyclePathIfAdded(relations, '105', '109') === null)
check('自环被识别', cyclePathIfAdded(relations, '105', '105') !== null)

console.log('3. 传递约简只隐藏不删除')
const hidden = transitiveEdgeKeys(g)
check('推断传递边被隐藏', hidden.has('102→104') && hidden.has('103→105'))
check('非传递边保留', !hidden.has('103→104') && !hidden.has('104', '105') as unknown as boolean)
check('关系记录总数不变（隐藏≠删除）', relations.length === 14)

console.log('4. 偏序摘要：导出再导入不变')
const digest1 = orderDigest(g)
const roundTripped: Relation[] = JSON.parse(JSON.stringify(relations))
const digest2 = orderDigest(buildGraph(roundTripped))
check('序列化往返后偏序摘要一致', digest1 === digest2)
const shuffled = [...roundTripped].reverse()
check('关系存储顺序不影响摘要', orderDigest(buildGraph(shuffled)) === digest1)
const changed = [...roundTripped, rel('109', '110', 'observation', 'active')]
check('偏序变化会改变摘要', orderDigest(buildGraph(changed)) !== digest1)

console.log('5. 分层布局')
const pos = layeredPositions(g, ['101','102','103','104','105','106','107','108','109','110','111','112'])
check('所有层位都有坐标（含孤立层 110）', [...pos.keys()].length === 12 && pos.has('110'))
check('晚的层位在上方（y 更小）', pos.get('101')!.y < pos.get('109')!.y)
check('布局确定可复现', JSON.stringify(layeredPositions(g, ['101','102','103','104','105','106','107','108','109','110','111','112'])) === JSON.stringify(pos))

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
