import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, ReceiptText, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import { exportUsageJSON, valueMoney } from '../lib'
import { deleteUsageCost, getUsageValue, type UsageCost } from '../value-api'
import { ReferencePriceDialog, UsageCostDialog } from './value-forms'
import { ValueOverview } from './value-overview'

export function UsageValue(props: {
  range: { start: number; end: number } | null
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [form, setForm] = useState<'price' | 'cost' | null>(null)
  const [deleting, setDeleting] = useState<UsageCost | null>(null)
  const query = useQuery({
    queryKey: ['usage-value', props.range?.start, props.range?.end],
    queryFn: () => {
      if (!props.range) throw new Error('Invalid range')
      return getUsageValue(props.range)
    },
    enabled: !!props.range,
    retry: false,
  })
  const saved = () => {
    setForm(null)
    setDeleting(null)
    void client.invalidateQueries({ queryKey: ['usage-value'] })
  }
  const remove = useMutation({ mutationFn: deleteUsageCost, onSuccess: saved })
  return (
    <section className='min-w-0 space-y-5 py-4'>
      <div className='flex flex-wrap gap-2'>
        <Button variant='outline' onClick={() => setForm('price')}>
          <Plus />
          {t('Add reference price version')}
        </Button>
        <Button variant='outline' onClick={() => setForm('cost')}>
          <ReceiptText />
          {t('Register actual cost')}
        </Button>
        <Button
          variant='outline'
          disabled={
            !query.data || query.isFetching || query.isError || !props.range
          }
          onClick={() =>
            exportUsageJSON(
              query.data,
              `usage-value-${props.range?.start}.json`
            )
          }
        >
          <Download />
          {t('Export JSON')}
        </Button>
        <Button
          variant='ghost'
          size='icon'
          title={t('Refresh')}
          aria-label={t('Refresh value accounting')}
          disabled={!props.range || query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw />
        </Button>
      </div>
      {props.range && query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <p role='alert' className='text-destructive'>
          {t(
            getServerErrorMessageKey(query.error) || 'member_usage_unavailable'
          )}
        </p>
      )}
      {!props.range && <p role='alert'>{t('member_usage_invalid_range')}</p>}
      {query.data && !query.isError && props.range && (
        <>
          <ValueOverview data={query.data} />
          <details className='border-y py-3'>
            <summary className='cursor-pointer font-medium'>
              {t('Reference price versions')} ({query.data.prices.length})
            </summary>
            {query.data.prices.length === 0 && (
              <p className='py-3 text-sm'>{t('No reference prices')}</p>
            )}
            <div className='max-h-80 divide-y overflow-auto'>
              {query.data.prices.map((p) => (
                <div key={p.id} className='space-y-1 py-3 text-sm break-words'>
                  <strong>{p.model}</strong> · {t('Channel')} #{p.channel_id} ·
                  #{p.id}
                  <p>
                    {formatTimestamp(p.effective_at)} ·{' '}
                    {t('Input / output CNY per million')}: {p.input} /{' '}
                    {p.output}
                  </p>
                  <p>
                    {t('Cache read / write / 1h CNY per million')}:{' '}
                    {p.cache_read || '-'} / {p.cache_write || '-'} /{' '}
                    {p.cache_write_1h || '-'}
                  </p>
                  <p className='text-muted-foreground'>{p.source}</p>
                </div>
              ))}
            </div>
          </details>
          <div className='space-y-2'>
            <h3 className='text-sm font-medium'>
              {t('Registered costs in period')}
            </h3>
            {query.data.costs.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                {t('No costs registered')}
              </p>
            )}
            <div className='divide-y'>
              {query.data.costs.map((cost) => (
                <div
                  key={cost.id}
                  className='flex items-start justify-between gap-3 py-3'
                >
                  <div className='min-w-0 text-sm break-words'>
                    <strong>
                      {t(`value_cost_${cost.category}`)} ·{' '}
                      {valueMoney(cost.amount)}
                    </strong>
                    <p>{cost.note}</p>
                    <p className='text-muted-foreground text-xs'>
                      {formatTimestamp(cost.incurred_at)}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    title={t('Void cost record')}
                    aria-label={t('Void cost record')}
                    onClick={() => setDeleting(cost)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <details className='border-t py-3'>
        <summary className='cursor-pointer text-sm font-medium'>
          {t('Accounting basis')}
        </summary>
        <div className='space-y-3 pt-3 text-sm'>
          <p>{t('value_formula')}</p>
          <p>{t('value_data_scope')}</p>
          <p>{t('value_price_scope')}</p>
          <p>{t('value_cost_scope')}</p>
          <p>
            <a
              className='underline'
              href='https://openrouter.ai/docs/faq'
              target='_blank'
              rel='noreferrer'
            >
              OpenRouter
            </a>{' '}
            ·{' '}
            <a
              className='underline'
              href='https://openrouter.ai/docs/guides/guides/usage-accounting'
              target='_blank'
              rel='noreferrer'
            >
              {t('Usage accounting reference')}
            </a>
          </p>
        </div>
      </details>
      {form === 'price' && (
        <ReferencePriceDialog
          models={[...new Set(query.data?.rows.map((r) => r.model) ?? [])]}
          onClose={() => setForm(null)}
          onSaved={saved}
        />
      )}
      {form === 'cost' && (
        <UsageCostDialog onClose={() => setForm(null)} onSaved={saved} />
      )}
      {deleting && (
        <Dialog
          open
          title={t('Void cost record')}
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleting(null)
          }}
          footer={
            <Button
              variant='destructive'
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting.id)}
            >
              {t('Confirm')}
            </Button>
          }
        >
          <p>
            {deleting.note} · {valueMoney(deleting.amount)}
          </p>
          <p>{t('value_void_scope')}</p>
          {remove.isError && (
            <p role='alert'>{t('member_usage_unavailable')}</p>
          )}
        </Dialog>
      )}
    </section>
  )
}
