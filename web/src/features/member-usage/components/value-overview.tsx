import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { valueMoney } from '../lib'
import type { ValueRow, ValueSummary } from '../value-api'

function Metric(props: { label: string; value: string; detail?: ReactNode }) {
  const metric = (
    <div className='min-w-0 rounded-md px-3 py-2'>
      <dt className='text-muted-foreground text-xs break-words'>
        {props.label}
      </dt>
      <dd className='mt-1 text-lg font-semibold break-words tabular-nums'>
        {props.value}
      </dd>
    </div>
  )
  if (!props.detail) return metric
  return (
    <div className='group relative min-w-0 text-left'>
      <button
        type='button'
        className='hover:bg-muted/60 block w-full min-w-0 cursor-help rounded-md text-left focus-visible:ring-2 focus-visible:outline-none'
      >
        {metric}
      </button>
      <div className='bg-popover text-popover-foreground pointer-events-none invisible absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border p-3 text-xs leading-5 opacity-0 shadow-lg transition-opacity group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100'>
        {props.detail}
      </div>
    </div>
  )
}

function ValueLine(props: { label: string; children: ReactNode }) {
  return (
    <div className='grid min-w-0 grid-cols-[max-content,minmax(0,1fr)] items-start gap-x-2'>
      <span className='text-muted-foreground'>{props.label}：</span>
      <span className='min-w-0 break-words tabular-nums'>{props.children}</span>
    </div>
  )
}

type MemberValueGroup = {
  user_id: number
  username: string
  records: number
  priced: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  reference_value: number
  pending: Record<string, number>
  rows: ValueRow[]
}

type ModelValueRow = ValueRow & { price_ids: number[] }

function mergeMemberModelRows(rows: ValueRow[]): ModelValueRow[] {
  const merged = new Map<string, ModelValueRow>()
  for (const row of rows) {
    const key = `${row.user_id}:${row.model}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...row, price_ids: [...(row.price_ids ?? [])] })
      continue
    }
    existing.records += row.records
    existing.priced += row.priced
    existing.input += row.input
    existing.output += row.output
    existing.cache_read += row.cache_read
    existing.cache_write += row.cache_write
    existing.reference_value = (
      Number(existing.reference_value) + Number(row.reference_value)
    ).toString()
    existing.price_ids = [
      ...new Set([...existing.price_ids, ...(row.price_ids ?? [])]),
    ]
    for (const [reason, count] of Object.entries(row.pending ?? {})) {
      existing.pending[reason] = (existing.pending[reason] ?? 0) + count
    }
  }
  return [...merged.values()]
}

// The top-level Token and reference-value metrics cover every member.  Their
// hover panels therefore need a second aggregation by model; rendering the
// member rows directly makes one model appear once per member/channel.
function mergeRowsByModel(rows: ValueRow[]): ModelValueRow[] {
  const merged = new Map<string, ModelValueRow>()
  for (const row of rows) {
    const key = row.model.trim() || `#${row.channel_id}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...row,
        price_ids: [...(row.price_ids ?? [])],
      })
      continue
    }
    existing.records += row.records
    existing.priced += row.priced
    existing.input += row.input
    existing.output += row.output
    existing.cache_read += row.cache_read
    existing.cache_write += row.cache_write
    existing.reference_value = (
      Number(existing.reference_value) + Number(row.reference_value)
    ).toString()
    existing.price_ids = [
      ...new Set([...existing.price_ids, ...(row.price_ids ?? [])]),
    ]
    for (const [reason, count] of Object.entries(row.pending ?? {})) {
      existing.pending[reason] = (existing.pending[reason] ?? 0) + count
    }
  }
  return [...merged.values()].sort((a, b) => a.model.localeCompare(b.model))
}

function formatNumber(value: string | undefined): string {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? amount.toLocaleString('zh-CN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
      })
    : '-'
}

function latestModelPrice(
  prices: ValueSummary['prices'],
  model: string,
  ids: number[]
) {
  const official = (price: ValueSummary['prices'][number]) =>
    price.official === true ||
    `${price.source_url || ''} ${price.source || ''}`
      .toLowerCase()
      .includes('openai')
  const candidates = prices.filter((price) => price.model === model)
  const officialCandidates = candidates.filter(official)
  const pool = officialCandidates.length > 0 ? officialCandidates : candidates
  return (
    [...pool].sort(
      (left, right) =>
        (right.synced_at || right.effective_at) -
          (left.synced_at || left.effective_at) || right.id - left.id
    )[0] || prices.find((price) => ids.includes(price.id))
  )
}

function ModelUsageDetails(props: { member: MemberValueGroup }) {
  const { t } = useTranslation()
  const rows = mergeRowsByModel(props.member.rows)
  return (
    <div className='group relative inline-block text-left'>
      <button
        type='button'
        className='text-primary cursor-help text-xs underline underline-offset-2'
      >
        {t('View model usage')}
      </button>
      <div className='bg-popover text-popover-foreground pointer-events-none invisible absolute right-0 z-20 mt-1 w-80 rounded-md border p-3 text-xs opacity-0 shadow-lg transition-opacity group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100'>
        {rows.map((row) => (
          <div
            key={`${row.user_id}:${row.model}`}
            className='space-y-1 border-b py-2 first:pt-0 last:border-0 last:pb-0'
          >
            <div className='font-medium break-words'>{row.model}</div>
            <div>
              {t('Token usage')}: {(row.input + row.output).toLocaleString()} (
              {t('Input tokens')}: {row.input.toLocaleString()} ·{' '}
              {t('Output tokens')}: {row.output.toLocaleString()})
            </div>
            <div>
              {t('Reference value (CNY)')}:{' '}
              {row.priced
                ? valueMoney(row.reference_value)
                : t('Not calculated')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AllModelTokenDetails(props: { members: MemberValueGroup[] }) {
  const { t } = useTranslation()
  const rows = mergeRowsByModel(props.members.flatMap((member) => member.rows))
  return (
    <div className='space-y-2'>
      <div className='font-medium'>{t('Model token details')}</div>
      <div>
        {rows.map((row) => (
          <div
            key={row.model}
            className='space-y-1 border-b py-2 first:pt-0 last:border-0 last:pb-0'
          >
            <div className='font-medium break-words'>{row.model}</div>
            <div>
              {t('Token usage')}: {(row.input + row.output).toLocaleString()}
            </div>
            <div>
              {t('Input tokens')}: {row.input.toLocaleString()} ·{' '}
              {t('Output tokens')}: {row.output.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AllModelValueDetails(props: {
  members: MemberValueGroup[]
  prices: ValueSummary['prices']
}) {
  const { t } = useTranslation()
  const rows = mergeRowsByModel(props.members.flatMap((member) => member.rows))
  return (
    <div className='space-y-2'>
      <div className='font-medium'>{t('Model price details')}</div>
      <div>
        {rows.map((row) => (
          <div
            key={row.model}
            className='space-y-1 border-b py-2 first:pt-0 last:border-0 last:pb-0'
          >
            <div className='font-medium break-words'>{row.model}</div>
            <div>
              {t('Token usage')}: {(row.input + row.output).toLocaleString()}
            </div>
            <div>
              {t('Unit price')}:{' '}
              {(() => {
                const price = latestModelPrice(
                  props.prices,
                  row.model,
                  row.price_ids
                )
                return price
                  ? `${formatNumber(price.input)} / ${formatNumber(price.output)} ${t('per million tokens')}`
                  : t('Not calculated')
              })()}
            </div>
            <div>
              {t('Reference value (CNY)')}:{' '}
              {row.priced
                ? valueMoney(row.reference_value)
                : t('Not calculated')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function groupRowsByMember(rows: ValueRow[]): MemberValueGroup[] {
  const groups = new Map<number, MemberValueGroup>()
  for (const row of rows) {
    const group = groups.get(row.user_id) ?? {
      user_id: row.user_id,
      username: row.username,
      records: 0,
      priced: 0,
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
      reference_value: 0,
      pending: {},
      rows: [],
    }
    group.username ||= row.username
    group.records += row.records
    group.priced += row.priced
    group.input += row.input
    group.output += row.output
    group.cache_read += row.cache_read
    group.cache_write += row.cache_write
    const referenceValue = Number(row.reference_value)
    if (Number.isFinite(referenceValue)) group.reference_value += referenceValue
    for (const [reason, count] of Object.entries(row.pending ?? {})) {
      group.pending[reason] = (group.pending[reason] ?? 0) + count
    }
    group.rows.push(row)
    groups.set(row.user_id, group)
  }
  return [...groups.values()].sort((left, right) =>
    (left.username || `#${left.user_id}`).localeCompare(
      right.username || `#${right.user_id}`
    )
  )
}

export function ValueOverview(props: { data: ValueSummary }) {
  const { t } = useTranslation()
  const s = props.data
  const records = Number.isFinite(s.records) ? s.records : 0
  const priced = Number.isFinite(s.priced) ? s.priced : 0
  const procurementCost = s.actual_procurement_cost || s.upstream_cost || '0'
  const multiplier = Number(s.value_multiplier)
  const canCompare = s.savings_comparable && Number.isFinite(multiplier)
  const rawSavings = Number(s.savings_value || 0)
  // Historical report snapshots may contain the old negative calculation.
  // Keep both live and archived views consistent with the current definition:
  // saving is never less than zero.
  const savings = Number.isFinite(rawSavings) ? Math.max(0, rawSavings) : 0
  const referenceValue =
    records === 0 || priced > 0
      ? valueMoney(s.reference_value || '0')
      : t('Not calculated')
  const rows = Array.isArray(s.rows)
    ? s.rows.map((row) => ({
        ...row,
        records: row.records ?? 0,
        priced: row.priced ?? 0,
        input: row.input ?? 0,
        output: row.output ?? 0,
        pending: row.pending ?? {},
      }))
    : []
  const mergedRows = mergeMemberModelRows(rows)
  const memberGroups = groupRowsByMember(mergedRows)
  const missingPriceRecords = rows.reduce(
    (total, row) => total + (row.pending.missing_price ?? 0),
    0
  )

  const mainStats: Array<{ label: string; value: string; detail?: ReactNode }> =
    [
      {
        label: t('Member tokens used'),
        value: (s.upstream_tokens || s.raw_tokens || 0).toLocaleString(),
      },
      { label: t('Official reference value'), value: referenceValue },
      {
        label: t('Actual procurement cost'),
        value:
          procurementCost !== '0'
            ? valueMoney(procurementCost)
            : t('Not registered'),
      },
      {
        label: t('Estimated savings'),
        value: canCompare
          ? valueMoney(savings.toString())
          : t('Not calculated'),
      },
    ]

  mainStats[0].detail = <AllModelTokenDetails members={memberGroups} />
  mainStats[1].detail = (
    <AllModelValueDetails members={memberGroups} prices={s.prices} />
  )

  mainStats[2].detail = (
    <div className='space-y-1'>
      <div className='font-medium'>{t('Actual procurement cost')}</div>
      <div>
        {t('Recorded costs')}: {valueMoney(s.recorded_cost || '0')}
      </div>
      <div>
        {t('Upstream cost')}: {valueMoney(s.upstream_cost || '0')}
      </div>
      <div className='text-muted-foreground'>
        {t('Only recorded procurement and operating costs are included.')}
      </div>
    </div>
  )
  mainStats[3].detail = (
    <div className='space-y-1'>
      <div className='font-medium'>{t('Estimated savings')}</div>
      <div>
        {t('Official reference value')} - {t('Actual procurement cost')}
      </div>
      {canCompare && priced < records && (
        <p className='text-muted-foreground'>
          {t(
            'Partial savings estimate: priced usage minus all registered procurement costs. Pending usage is excluded, not free.'
          )}
        </p>
      )}
      <div>
        {t('Value multiplier')}:{' '}
        {canCompare ? `${multiplier.toFixed(2)}×` : t('Not calculated')}
      </div>
      <div>
        {t('Cache hit rate')}:{' '}
        {s.cache_eligible_input > 0
          ? `${(s.cache_hit_rate * 100).toFixed(1)}%`
          : t('No cache data')}
      </div>
      <div className='text-muted-foreground'>
        {t('Official price coverage')}:{' '}
        <span>
          {priced} / {records}
        </span>
      </div>
    </div>
  )

  return (
    <div className='min-w-0 space-y-4'>
      <dl className='grid grid-cols-2 gap-2 border-y py-3 lg:grid-cols-4'>
        {mainStats.map((stat) => (
          <Metric key={stat.label} {...stat} />
        ))}
      </dl>
      <p className='text-muted-foreground text-xs'>
        {t('Hover a value to view model, price and calculation details.')}{' '}
        {t('value_nonprofit_scope')}
      </p>
      {canCompare && priced < records && (
        <p className='text-muted-foreground text-xs' role='status'>
          {t(
            'Partial savings estimate: priced usage minus all registered procurement costs. Pending usage is excluded, not free.'
          )}
        </p>
      )}
      {missingPriceRecords > 0 && (
        <p className='text-muted-foreground rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs'>
          {t('value_pending_price_explanation', {
            count: missingPriceRecords,
          })}
        </p>
      )}
      <div className='space-y-3'>
        {memberGroups.length === 0 && (
          <p className='text-muted-foreground py-6 text-center text-sm'>
            {t('No accounting records')}
          </p>
        )}
        {memberGroups.map((member) => (
          <details
            key={member.user_id}
            className='relative overflow-visible rounded-lg border'
          >
            <summary className='hover:bg-muted/40 flex cursor-pointer list-none items-start justify-between gap-4 px-3 py-3 [&::-webkit-details-marker]:hidden'>
              <div className='min-w-0'>
                <div className='font-medium break-words'>
                  {member.username || `#${member.user_id}`}
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  #{member.user_id} · {member.rows.length} {t('Model entries')}
                </div>
              </div>
              <div className='shrink-0 text-right text-sm tabular-nums'>
                <div>
                  {(member.input + member.output).toLocaleString()}{' '}
                  {t('Tokens')}
                </div>
                <ModelUsageDetails member={member} />
                <div className='text-muted-foreground mt-1 text-xs'>
                  {member.records.toLocaleString()} {t('Usage records')} ·{' '}
                  {member.priced} / {member.records}{' '}
                  {t('Official price coverage')}
                </div>
              </div>
            </summary>
            <div className='grid min-w-0 gap-x-6 gap-y-2 border-t px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3'>
              <ValueLine label={t('Member token total')}>
                {(member.input + member.output).toLocaleString()}
              </ValueLine>
              <ValueLine label={t('Reference value (CNY)')}>
                {member.priced
                  ? valueMoney(member.reference_value.toString())
                  : t('Not calculated')}
              </ValueLine>
              <ValueLine label={t('Cache read tokens')}>
                {member.cache_read.toLocaleString()}
              </ValueLine>
              <ValueLine label={t('Notes')}>
                {Object.keys(member.pending).length > 0 ? (
                  Object.entries(member.pending).map(([reason, count]) => (
                    <div key={reason}>
                      {t(`value_pending_${reason}`)}: {count}
                    </div>
                  ))
                ) : (
                  <span className='text-muted-foreground'>{t('None')}</span>
                )}
              </ValueLine>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
