import { reactive } from 'vue'
import type { Demand, Plan } from '@/types'

// 生成中的方案还没落到「我的行程」，先放内存，刷新即失效（首期不做草稿箱）
export const draft = reactive<{ demand: Demand | null; plans: Plan[]; error: string }>({
  demand: null,
  plans: [],
  error: ''
})

export const emptyDemand = (): Demand => ({
  destination: '',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: ''
})
