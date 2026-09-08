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
import { formatTimestamp } from '@/lib/format'

import type { UsageMember, UsageSummary } from '../types'

export function UsageStats(props: { summary: UsageSummary }) {
  const { t } = useTranslation()
  const stats = [
    {
      label: t('Active members'),
      value: props.summary.active_members,
      color: 'text-emerald-600',
    },
    {
      label: t('Accounting records'),
      value: props.summary.totals.consume_records,
      color: '',
    },
    {
      label: t('Recorded base tokens'),
      value: props.summary.totals.tokens,
      color: '',
    },
    {
      label: t('Members needing review'),
      value: props.summary.attention_members,
      color: 'text-amber-600',
    },
    {
      label: t('Peak RPM'),
      value: Math.max(...props.summary.members.map((m) => m.peak_minute_records), 0),
      color: '',
    },
  ]
  return (
    <dl className='grid grid-cols-2 gap-5 border-y py-5 lg:grid-cols-4'>
      {stats.map((stat) => (
        <div key={stat.label} className='min-w-0'>
          <dt className='text-muted-foreground text-xs'>{stat.label}</dt>
          <dd
            className={`mt-2 text-2xl font-semibold break-all tabular-nums ${stat.color}`}
          >
            {stat.value.toLocaleString()}
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
    <div className='min-w-0 overflow-x-auto rounded-lg border'>
      <Table className='min-w-[980px] table-fixed [&_th]:break-words [&_th]:whitespace-normal'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-36'>{t('Member')}</TableHead>
            <TableHead className='w-24'>{t('Member type')}</TableHead>
            <TableHead className='w-56'>
              {t('Current declared purpose')}
            </TableHead>
            <TableHead className='w-32 text-right'>{t('Request activity')}</TableHead>
            <TableHead className='w-32 text-right'>{t('Token usage')}</TableHead>
            <TableHead className='w-32 text-right'>{t('Request frequency')}</TableHead>
            <TableHead className='w-48'>{t('Review signals')}</TableHead>
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
                colSpan={props.onEdit ? 8 : 7}
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
                  {member.profile.project || t('Not registered')}
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  {member.profile.purpose || t('Not registered')}
                </div>
                <div className='text-muted-foreground mt-2 text-xs break-all'>
                  {member.models.join(', ') || '-'}
                </div>
              </TableCell>
              <TableCell className='text-right align-top tabular-nums'>
                <div>{member.consume_records.toLocaleString()} {t('calls')}</div>
                <div className='text-muted-foreground text-xs'>
                  {member.error_records.toLocaleString()} {t('errors')} · {((member.error_rate ?? 0) * 100).toFixed(1)}%
                </div>
              </TableCell>
              <TableCell className='text-right align-top tabular-nums'>
                <div>{member.tokens.toLocaleString()} {t('Tokens')}</div>
                <div className='text-muted-foreground text-xs break-all'>
                  {member.charged_quota.toLocaleString()} / {member.refund_quota.toLocaleString()}
                </div>
              </TableCell>
              <TableCell className='text-right align-top tabular-nums'>
                <div>{t('Peak RPM')}: {member.peak_minute_records.toLocaleString()}</div>
                <div className='text-muted-foreground text-xs'>
                  {t('Average RPM')}: {(member.average_rpm ?? 0).toFixed(2)}
                </div>
              </TableCell>
              <TableCell className='align-top whitespace-normal'>
                <div className='flex flex-wrap gap-1'>
                  {member.attention.map((signal) => (
                    <Badge key={signal} variant='warning'>
                      {t(`usage_signal_${signal}`)}
                    </Badge>
                  ))}
                </div>
                {member.attention.length === 0 && (
                  <span className='text-muted-foreground text-xs'>
                    {t('No signals triggered')}
                  </span>
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
                          aria-label={t('Edit member attribution')}
                          onClick={() => props.onEdit?.(member)}
                        />
                      }
                    >
                      <Pencil />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('Edit member attribution')}
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
