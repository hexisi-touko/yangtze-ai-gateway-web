import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, ReceiptText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import { exportUsageJSON, valueMoney } from '../lib'
import {
  deleteUsageCost,
  getUsageValue,
  type OfficialPriceSyncResult,
  type ReferencePrice,
  type UsageCost,
  type ValueSummary,
} from '../value-api'
import { OfficialPriceSyncDialog, UsageCostDialog } from './value-forms'
import { ValueOverview } from './value-overview'

function mergeReferencePrices(
  existing: ReferencePrice[],
  incoming: ReferencePrice[]
): ReferencePrice[] {
  const priceKey = (price: ReferencePrice) =>
    Number(price.id) > 0
      ? `id:${price.id}`
      : `${price.model}:${price.channel_id}:${price.effective_at}`
  const merged = new Map<string, ReferencePrice>()
  for (const price of existing) merged.set(priceKey(price), price)
  for (const price of incoming) merged.set(priceKey(price), price)
  return [...merged.values()].sort(
    (left, right) =>
      right.effective_at - left.effective_at || right.id - left.id
  )
}

function formatPrice(value: string | undefined): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

function deduplicateOfficialPrices(prices: ReferencePrice[]): ReferencePrice[] {
  const byModel = new Map<string, ReferencePrice>()
  for (const price of prices) {
    const current = byModel.get(price.model)
    if (!current || (price.synced_at ?? price.effective_at) > (current.synced_at ?? current.effective_at)) {
      byModel.set(price.model, price)
    }
  }
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model))
}

function newestOfficialPrice(prices: ReferencePrice[]): ReferencePrice | undefined {
  return [...prices].sort(
    (left, right) =>
      (right.synced_at ?? right.effective_at) -
        (left.synced_at ?? left.effective_at) ||
      right.id - left.id
  )[0]
}

function isOfficialPrice(price: ReferencePrice): boolean {
  if (price.official === true) return true
  // Keep snapshots visible while an older GoLand binary is rolling out. The
  // sync endpoint predates the `official` flag in some local databases, but
  // its source metadata is still unambiguous.
  const source = `${price.source_url || ''} ${price.source || ''}`.toLowerCase()
  return (
    source.includes('developers.openai.com') ||
    source.includes('platform.openai.com') ||
    source.includes('openai official')
  )
}

function markOfficialPrices(prices: ReferencePrice[]): ReferencePrice[] {
  return prices.map((price) => ({ ...price, official: true }))
}

export function UsageValue(props: {
  range: { start: number; end: number } | null
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [form, setForm] = useState<'price' | 'cost' | null>(null)
  const [deleting, setDeleting] = useState<UsageCost | null>(null)
  const [syncedPrices, setSyncedPrices] = useState<ReferencePrice[]>([])
  const [lastSync, setLastSync] = useState<{
    count: number
    syncedAt: number
  } | null>(null)
  const queryKey = [
    'usage-value',
    props.range?.start,
    props.range?.end,
  ] as const
  const query = useQuery({
    queryKey,
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
  const priceSaved = (result: OfficialPriceSyncResult) => {
    // Show the response immediately. The follow-up query refresh keeps the
    // cache correct when the server has more historical price rows as well.
    const models = Array.isArray(result?.models)
      ? markOfficialPrices(result.models)
      : []
    setLastSync({
      count: models.length || result?.created || 0,
      syncedAt: result?.synced_at || Math.floor(Date.now() / 1000),
    })
    const rememberPrices = (prices: ReferencePrice[]) => {
      if (!prices.length) return
      setSyncedPrices((current) => mergeReferencePrices(current, prices))
      if (!props.range) return
      client.setQueryData<ValueSummary>(queryKey, (current) => {
        if (!current) return current
        return {
          ...current,
          prices: mergeReferencePrices(current.prices, prices),
        }
      })
    }
    rememberPrices(models)
    saved()
    // Older GoLand binaries may acknowledge the sync without returning the
    // model list. Read the saved snapshot explicitly. Updating the complete
    // query (rather than only its price array) also refreshes pricing coverage
    // and the reference value immediately after a sync.
    if (props.range) {
      void getUsageValue(props.range)
        .then((fresh) => {
          client.setQueryData(queryKey, fresh)
          rememberPrices(fresh.prices)
        })
        .catch(() => {
          // The mutation already succeeded; the next normal query refresh can
          // recover the snapshot if this compatibility read is unavailable.
        })
    }
  }
  const remove = useMutation({ mutationFn: deleteUsageCost, onSuccess: saved })
  const allPrices = mergeReferencePrices(query.data?.prices ?? [], syncedPrices)
  const officialPrices = deduplicateOfficialPrices(allPrices.filter(isOfficialPrice))
  // Manual prices must not be presented as official snapshots. Older backend
  // rows are still recognized by their OpenAI source metadata in
  // `isOfficialPrice` above.
  const displayedPrices = officialPrices
  const latestOfficial = newestOfficialPrice(officialPrices)
  const valueData =
    query.data && !query.isError && props.range ? query.data : null
  const hasValueData = valueData !== null
  return (
    <section className='min-w-0 space-y-5 py-4'>
      <div className='flex flex-wrap gap-2'>
        <Button variant='outline' onClick={() => setForm('price')}>
          {t('Sync official OpenAI prices')}
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
      {latestOfficial && (
        <p className='text-muted-foreground text-xs'>
          {t('Official source')}:{' '}
          {latestOfficial.source_url || latestOfficial.source} ·{' '}
          {t('Synced at')}:{' '}
          {formatTimestamp(
            latestOfficial.synced_at || latestOfficial.effective_at
          )}{' '}
          · {t('USD/CNY exchange rate')}:{' '}
          {latestOfficial.official_exchange_rate || '-'}
        </p>
      )}
      {lastSync && (
        <p className='text-muted-foreground text-xs'>
          {t('Last official price sync')}: {formatTimestamp(lastSync.syncedAt)}{' '}
          · {t('Models synced')}: {lastSync.count}
        </p>
      )}
      {(hasValueData || displayedPrices.length > 0 || lastSync !== null) && (
        <div className='space-y-2 border-y py-3'>
          <h3 className='font-medium'>
            {t('Official price snapshot')} ({displayedPrices.length})
          </h3>
          {displayedPrices.length === 0 && (
            <p className='py-3 text-sm'>{t('No reference prices')}</p>
          )}
          <details className='rounded-md border'>
            <summary className='hover:bg-muted/40 cursor-pointer px-3 py-2 text-sm'>
              {t('View official model prices')} ({displayedPrices.length})
            </summary>
            <div className='grid gap-2 border-t p-3 sm:grid-cols-2'>
              {displayedPrices.map((p) => (
                <div key={`${p.id}:${p.model}:${p.effective_at}`} className='min-w-0 rounded-md border p-3 text-sm'>
                  <strong className='break-words'>{p.model}</strong>
                  <div className='mt-1 text-xs'>{t('Input price')}: {formatPrice(p.input)} · {t('Output price')}: {formatPrice(p.output)}</div>
                  <div className='text-muted-foreground mt-1 text-xs'>{t('Cache read price')}: {formatPrice(p.cache_read)} · {t('Cache write price')}: {formatPrice(p.cache_write)}</div>
                  <div className='text-muted-foreground mt-1 text-xs'>{t('Synced at')}: {formatTimestamp(p.synced_at || p.effective_at)}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      {valueData && <ValueOverview data={valueData} />}
      {hasValueData && (
        <div className='space-y-2'>
          <h3 className='text-sm font-medium'>
            {t('Registered costs in period')}
          </h3>
          {valueData.costs.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t('No costs registered')}
            </p>
          )}
          <div className='divide-y'>
            {valueData.costs.map((cost) => (
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
        <OfficialPriceSyncDialog
          onClose={() => setForm(null)}
          onSaved={priceSaved}
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
