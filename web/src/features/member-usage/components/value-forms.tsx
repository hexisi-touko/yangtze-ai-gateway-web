import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import {
  addUsageCost,
  syncOfficialPrices,
  type OfficialPriceSyncResult,
} from '../value-api'

const money = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/)
const date = z.string().refine((v) => dayjs(v).isValid())
export function OfficialPriceSyncDialog(props: {
  onClose: () => void
  onSaved: (result: OfficialPriceSyncResult) => void
}) {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(z.object({ exchange_rate: money })),
    defaultValues: {
      exchange_rate: '7.2',
    },
  })
  const mutation = useMutation({
    mutationFn: syncOfficialPrices,
    onSuccess: props.onSaved,
  })
  return (
    <Dialog
      open
      title={t('Sync official OpenAI prices')}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      bodyClassName='space-y-4'
      footer={
        <Button
          form='official-price-sync'
          type='submit'
          disabled={mutation.isPending}
        >
          {t('Sync')}
        </Button>
      }
    >
      <form
        id='official-price-sync'
        className='space-y-4'
        onSubmit={form.handleSubmit(({ exchange_rate }) =>
          mutation.mutate(exchange_rate)
        )}
      >
        <div>
          <Label htmlFor='value-exchange-rate'>
            {t('USD/CNY exchange rate')}
          </Label>
          <Input
            id='value-exchange-rate'
            inputMode='decimal'
            {...form.register('exchange_rate')}
          />
          <p className='text-muted-foreground mt-2 text-xs'>
            {t('official_price_sync_help')}
          </p>
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert' className='text-destructive'>
            {t('member_usage_value_invalid_exchange_rate')}
          </p>
        )}
        {mutation.isError && (
          <p role='alert' className='text-destructive'>
            {t(
              getServerErrorMessageKey(mutation.error) ||
                'member_usage_unavailable'
            )}
          </p>
        )}
      </form>
      <p className='text-muted-foreground text-xs'>
        {t('official_price_scope')}
      </p>
    </Dialog>
  )
}
const costSchema = z.object({
  category: z.enum(['subscription', 'upstream', 'server', 'analysis', 'other']),
  amount: money,
  incurred: date,
  note: z.string().trim().min(1).max(500),
})
export function UsageCostDialog(props: {
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(costSchema),
    defaultValues: {
      category: 'subscription' as const,
      amount: '',
      incurred: dayjs().format('YYYY-MM-DD'),
      note: '',
    },
  })
  const mutation = useMutation({
    mutationFn: addUsageCost,
    onSuccess: props.onSaved,
  })
  return (
    <Dialog
      open
      title={t('Register actual cost')}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      bodyClassName='space-y-4'
      footer={
        <Button form='usage-cost' type='submit' disabled={mutation.isPending}>
          {t('Save')}
        </Button>
      }
    >
      <form
        id='usage-cost'
        className='space-y-4'
        onSubmit={form.handleSubmit(({ incurred, ...values }) =>
          mutation.mutate({ ...values, incurred_at: dayjs(incurred).unix() })
        )}
      >
        <div>
          <Label htmlFor='cost-category'>{t('Cost category')}</Label>
          <select
            id='cost-category'
            className='bg-background h-9 w-full rounded-md border px-2'
            {...form.register('category')}
          >
            {['subscription', 'upstream', 'server', 'analysis', 'other'].map(
              (c) => (
                <option key={c} value={c}>
                  {t(`value_cost_${c}`)}
                </option>
              )
            )}
          </select>
        </div>
        <div>
          <Label htmlFor='cost-amount'>{t('Actual amount (CNY)')}</Label>
          <Input
            id='cost-amount'
            inputMode='decimal'
            {...form.register('amount')}
          />
        </div>
        <div>
          <Label htmlFor='cost-date'>{t('Cost recognition date')}</Label>
          <Input
            id='cost-date'
            type='date'
            max={dayjs().format('YYYY-MM-DD')}
            {...form.register('incurred')}
          />
        </div>
        <div>
          <Label htmlFor='cost-note'>{t('Cost description')}</Label>
          <Input id='cost-note' maxLength={500} {...form.register('note')} />
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert' className='text-destructive'>
            {t('member_usage_value_invalid_cost')}
          </p>
        )}
        {mutation.isError && (
          <p role='alert' className='text-destructive'>
            {t(
              getServerErrorMessageKey(mutation.error) ||
                'member_usage_unavailable'
            )}
          </p>
        )}
      </form>
      <p className='text-muted-foreground text-xs'>{t('value_cost_scope')}</p>
    </Dialog>
  )
}
