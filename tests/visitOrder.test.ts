import { describe, expect, it } from 'vitest'
import { orderVisits } from '@core/visitOrder'

describe('orderVisits', () => {
  it('sorts numbered visits numerically', () => {
    expect(orderVisits(['Month 0', 'Month 6', 'Month 12', 'Month 18', 'Month 2'])).toEqual(['Month 0', 'Month 2', 'Month 6', 'Month 12', 'Month 18'])
    expect(orderVisits(['Visit 1', 'Visit 10', 'Visit 2'])).toEqual(['Visit 1', 'Visit 2', 'Visit 10'])
  })
  it('keeps unrelated names in first-appearance order', () => {
    expect(orderVisits(['Screening', 'Baseline', 'Week 4', 'Follow-up'])).toEqual(['Screening', 'Baseline', 'Week 4', 'Follow-up'])
  })
  it('sorts each numbered family within its own slots', () => {
    expect(orderVisits(['Baseline', 'Week 8', 'Month 3', 'Week 2', 'Month 1'])).toEqual(['Baseline', 'Week 2', 'Month 1', 'Week 8', 'Month 3'])
  })
})
