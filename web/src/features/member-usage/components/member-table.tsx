import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatQuotaAmount, formatTimestamp } from '@/lib/format'

import type { UsageMember, UsageSummary } from '../types'

const memberUsageTooltipClass =
  'border-border !bg-card !text-foreground rounded-lg shadow-lg'

function MetricHint(props: { member: UsageMember }) {
  const member = props.member
  const cache =
    (member.cache_eligible_input ?? 0) > 0
      ? `${((member.cache_hit_rate ?? 0) * 100).toFixed(1)}%`
      : '暂无缓存数据'
  return (
    <TooltipContent
      side='top'
      className={`${memberUsageTooltipClass} w-64 p-3 text-xs`}
      arrowClassName='!bg-card !fill-card'
    >
      <div className='grid grid-cols-2 gap-x-5 gap-y-3'>
        <div>
          <div className='text-muted-foreground'>请求次数</div>
          <div className='mt-1 text-sm font-semibold tabular-nums'>
            {member.consume_records.toLocaleString()}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground'>Token 用量</div>
          <div className='mt-1 text-sm font-semibold tabular-nums'>
            {member.tokens.toLocaleString()}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground'>缓存命中率</div>
          <div className='mt-1 text-sm font-semibold tabular-nums'>{cache}</div>
        </div>
        <div>
          <div className='text-muted-foreground'>请求频率</div>
          <div className='mt-1 text-sm font-semibold tabular-nums'>
            {(member.active_average_rpm ?? 0).toFixed(2)} / 分钟
          </div>
        </div>
      </div>
    </TooltipContent>
  )
}

function CompactMetrics(props: { member: UsageMember }) {
  const { t } = useTranslation()
  const member = props.member
  const cache =
    (member.cache_eligible_input ?? 0) > 0
      ? `${((member.cache_hit_rate ?? 0) * 100).toFixed(1)}%`
      : t('No cache data')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role='group'
            tabIndex={0}
            className='hover:bg-muted/60 grid w-full min-w-[530px] grid-cols-3 gap-x-5 gap-y-2 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none'
          >
            <span className='text-sm'>
              <span className='text-muted-foreground'>{t('Requests')}：</span>
              <b className='tabular-nums'>
                {member.consume_records.toLocaleString()}
              </b>
            </span>
            <span className='text-sm'>
            <span className='text-muted-foreground'>
              {t('Token usage')}：
            </span>
              <b className='tabular-nums'>
                {member.tokens.toLocaleString()} {t('Tokens')}
              </b>
            </span>
            <span className='text-sm'>
              <span className='text-muted-foreground'>
                {t('Remaining quota')}：
              </span>
              <b className='tabular-nums'>
                {formatQuotaAmount(member.remaining_quota)}
              </b>
            </span>
            <span className='text-sm'>
              <span className='text-muted-foreground'>
                {t('Cache hit rate')}：
              </span>
              <b className='tabular-nums'>{cache}</b>
            </span>
            <span className='text-sm'>
              <span className='text-muted-foreground'>
                {t('RPM (auxiliary)')}：
              </span>
              <b className='tabular-nums'>
                {(member.active_average_rpm ?? 0).toFixed(2)}
              </b>
            </span>
            <span className='flex items-center gap-1 text-sm'>
              <span className='text-muted-foreground'>{t('Request IP')}：</span>
              <b className='font-mono font-normal'>
                {member.recent_ips?.[0] || t('No IP records')}
              </b>
            </span>
          </div>
        }
      />
      <span className='sr-only'>{t('Review signals')}</span>
      <MetricHint member={member} />
    </Tooltip>
  )
}

export function UsageStats(props: { summary: UsageSummary }) {
  const { t } = useTranslation()
  const members = Array.isArray(props.summary.members)
    ? props.summary.members
    : []
  const totals = props.summary.totals ?? {
    consume_records: 0,
    error_records: 0,
    refund_records: 0,
    tokens: 0,
    cache_read_tokens: 0,
    cache_eligible_input: 0,
    cache_hit_rate: 0,
    charged_quota: 0,
    refund_quota: 0,
  }
  const activeMembers = Number.isFinite(props.summary.active_members)
    ? props.summary.active_members
    : 0
  const stats = [
    {
      label: t('Active members'),
      value: activeMembers,
      color: 'text-emerald-600',
      rpm: false,
      percent: false,
    },
    {
      label: t('Accounting records'),
      value: totals.consume_records,
      color: '',
      rpm: false,
      percent: false,
    },
    {
      label: t('Recorded base tokens'),
      value: totals.tokens,
      color: '',
      rpm: false,
      percent: false,
    },
    {
      label: t('Cache hit rate'),
      value:
        (totals.cache_eligible_input ?? 0) > 0
          ? (totals.cache_hit_rate ?? 0) * 100
          : 0,
      color: 'text-sky-600',
      rpm: false,
      percent: true,
    },
    {
      label: t('Peak RPM'),
      value: Math.max(...members.map((m) => m.peak_minute_records), 0),
      color: '',
      rpm: true,
      percent: false,
    },
  ]
  const formatStatValue = (stat: (typeof stats)[number]) => {
    if (stat.percent) {
      return (totals.cache_eligible_input ?? 0) > 0
        ? `${stat.value.toFixed(1)}%`
        : t('No cache data')
    }
    if (stat.rpm) return stat.value.toFixed(2)
    return stat.value.toLocaleString()
  }
  return (
    <dl className='member-usage-stats bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-3 xl:grid-cols-5'>
      {stats.map((stat) => (
        <div key={stat.label} className='bg-card min-w-0 px-4 py-3.5'>
          <dt className='text-muted-foreground text-xs'>{stat.label}</dt>
          <dd
            className={`mt-1.5 text-xl font-semibold break-all tabular-nums ${stat.color}`}
          >
            {formatStatValue(stat)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function MemberTable(props: {
  members: UsageMember[]
  onEdit?: (member: UsageMember) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='member-usage-table bg-card min-w-0 overflow-x-auto rounded-lg border'>
      <Table className='min-w-[1060px] table-fixed [&_th]:break-words [&_th]:whitespace-normal'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-36'>{t('Member')}</TableHead>
            <TableHead className='w-28'>{t('Member type')}</TableHead>
            <TableHead className='w-64'>
              {t('Current client workspace')}
            </TableHead>
            <TableHead className='text-center'>{t('Usage metrics')}</TableHead>
            {props.onEdit && (
              <TableHead className='w-12'>
                <span className='sr-only'>{t('Edit')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.members.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={props.onEdit ? 5 : 4}
                className='text-muted-foreground h-36 text-center'
              >
                {t('No matching members')}
              </TableCell>
            </TableRow>
          )}
          {props.members.map((member) => (
            <TableRow key={member.user_id}>
              <TableCell className='align-top break-all whitespace-normal'>
                <div className='font-medium'>
                  {member.display_name ||
                    member.username ||
                    `#${member.user_id}`}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {member.username} · #{member.user_id}
                </div>
                {member.deleted && (
                  <Badge variant='secondary'>{t('Deleted member')}</Badge>
                )}
                <div className='text-muted-foreground mt-2 text-xs'>
                  {member.last_active
                    ? formatTimestamp(member.last_active)
                    : t('No recorded activity')}
                </div>
              </TableCell>
              <TableCell className='align-top'>
                {t(`usage_type_${member.profile.member_type}`)}
              </TableCell>
              <TableCell className='align-top break-words whitespace-normal'>
                <div className='font-medium'>
                  {member.workspace_project || t('No workspace reported')}
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  {member.workspace_source || t('No workspace source')}
                  {member.workspace_branch
                    ? ` · ${member.workspace_branch}`
                    : ''}
                </div>
                <div className='text-muted-foreground mt-2 text-xs'>
                  {member.workspace_last_seen
                    ? `${t('Last workspace report')}: ${formatTimestamp(member.workspace_last_seen)}`
                    : t('No workspace report')}
                </div>
              </TableCell>
              <TableCell className='align-middle'>
                <CompactMetrics member={member} />
                {member.attention.length > 0 && (
                  <div className='mt-1 flex flex-wrap gap-1 px-2'>
                    {member.attention.map((signal) => (
                      <Badge key={signal} variant='warning'>
                        {t(`usage_signal_${signal}`)}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              {props.onEdit && (
                <TableCell className='align-top'>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant='ghost'
                          size='icon'
                          disabled={member.deleted}
                          aria-label={t('Edit member type')}
                          onClick={() => props.onEdit?.(member)}
                        />
                      }
                    >
                      <Pencil />
                    </TooltipTrigger>
                    <TooltipContent
                      className={`${memberUsageTooltipClass} px-3 py-1.5 text-xs`}
                      arrowClassName='!bg-card !fill-card'
                    >
                      {t('Edit member type')}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
