import dayjs from 'dayjs'

import type { UsageMember } from './types'

export function valueMoney(value: string): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value))
}

export function usageDateRange(
  from: string,
  to: string
): { start: number; end: number } | null {
  const start = dayjs(from).startOf('day')
  const end = dayjs(to).add(1, 'day').startOf('day')
  if (
    !from ||
    !to ||
    !start.isValid() ||
    !end.isValid() ||
    start.format('YYYY-MM-DD') !== from ||
    dayjs(to).format('YYYY-MM-DD') !== to ||
    dayjs(to).isAfter(dayjs(), 'day') ||
    end.diff(start, 'second') <= 0 ||
    end.diff(start, 'second') > 31 * 86400
  ) {
    return null
  }
  return { start: start.unix(), end: end.unix() }
}

export function filterUsageMembers(
  members: UsageMember[],
  search: string,
  memberType: string,
  attentionOnly: boolean
): UsageMember[] {
  const query = search.trim().toLocaleLowerCase()
  return members.filter((member) => {
    if (memberType !== 'all' && member.profile.member_type !== memberType) {
      return false
    }
    if (attentionOnly && member.attention.length === 0) return false
    return [
      member.username,
      member.display_name,
      member.profile.project,
      member.profile.purpose,
    ].some((value) => value.toLocaleLowerCase().includes(query))
  })
}

export function exportUsageJSON(data: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
