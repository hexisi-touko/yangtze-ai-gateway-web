import { describe, expect, it } from 'vitest'

import { getReasoningEffortLabel } from '../format'

describe('getReasoningEffortLabel', () => {
  it('maps recorded reasoning levels to translated labels', () => {
    expect(getReasoningEffortLabel('xhigh')).toBe('Extra high')
    expect(getReasoningEffortLabel('HIGH')).toBe('High')
    expect(getReasoningEffortLabel('medium')).toBe('Medium')
    expect(getReasoningEffortLabel('low')).toBe('Low')
  })

  it('returns a stable fallback for missing or unknown levels', () => {
    expect(getReasoningEffortLabel(undefined)).toBe('Unknown')
    expect(getReasoningEffortLabel('future-level')).toBe('Unknown')
  })
})
