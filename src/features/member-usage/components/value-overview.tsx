import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { valueMoney } from '../lib'
import type { ValueSummary } from '../value-api'

export function ValueOverview(props: { data: ValueSummary }) {
  const { t } = useTranslation()
  const s = props.data
  const stats = [
    { label: 'Recorded base tokens', value: s.raw_tokens.toLocaleString() },
    {
      label: 'Reference service value (covered records)',
      value:
        s.priced || !s.records
          ? valueMoney(s.reference_value)
          : t('Not calculated'),
    },
    {
      label: 'Registered actual cost',
      value: s.costs.length
        ? valueMoney(s.recorded_cost)
        : t('No costs registered'),
    },
    { label: 'Pricing coverage', value: `${s.priced} / ${s.records}` },
  ]
  return (
    <div className='min-w-0 space-y-4'>
      <dl className='grid grid-cols-2 gap-5 border-y py-5 lg:grid-cols-4'>
        {stats.map((stat) => (
          <div key={stat.label} className='min-w-0'>
            <dt className='text-muted-foreground text-xs'>{t(stat.label)}</dt>
            <dd className='mt-2 text-lg font-semibold break-all tabular-nums'>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className='text-muted-foreground text-xs'>
        {t('value_nonprofit_scope')}
      </p>
      <dl className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-4'>
        <div>
          <dt>{t('Normalized input tokens')}</dt>
          <dd>{s.input.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{t('Recorded output tokens')}</dt>
          <dd>{s.output.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{t('Cache read / write tokens')}</dt>
          <dd>
            {s.cache_read.toLocaleString()} / {s.cache_write.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>{t('Normalized records')}</dt>
          <dd>
            {s.normalized_records} / {s.records}
          </dd>
        </div>
      </dl>
      <p className='text-muted-foreground text-xs'>
        {t('Explicitly estimated records')}: {s.estimated_records} ·{' '}
        {t('Unverified usage source')}: {s.unknown_source_records}
      </p>
      <div className='max-w-full overflow-x-auto'>
        <Table className='min-w-[900px]'>
          <TableHeader>
            <TableRow>
              {[
                'Member',
                'Model / channel',
                'Accounting records',
                'Input / output tokens',
                'Pricing coverage',
                'Reference value (CNY)',
                'Pending accounting',
              ].map((label) => (
                <TableHead key={label}>{t(label)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className='h-24 text-center'>
                  {t('No accounting records')}
                </TableCell>
              </TableRow>
            )}
            {s.rows.map((row) => (
              <TableRow key={`${row.user_id}:${row.channel_id}:${row.model}`}>
                <TableCell className='max-w-44 break-all whitespace-normal'>
                  {row.username || `#${row.user_id}`} · #{row.user_id}
                </TableCell>
                <TableCell className='max-w-56 break-all whitespace-normal'>
                  {row.model}
                  <div className='text-muted-foreground text-xs'>
                    #{row.channel_id}
                  </div>
                </TableCell>
                <TableCell>{row.records}</TableCell>
                <TableCell>
                  {row.input.toLocaleString()} / {row.output.toLocaleString()}
                </TableCell>
                <TableCell>
                  {row.priced} / {row.records}
                </TableCell>
                <TableCell>
                  {row.priced
                    ? valueMoney(row.reference_value)
                    : t('Not calculated')}
                </TableCell>
                <TableCell className='max-w-60 whitespace-normal'>
                  {Object.entries(row.pending).map(([reason, count]) => (
                    <div key={reason}>
                      {t(`value_pending_${reason}`)}: {count}
                    </div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
