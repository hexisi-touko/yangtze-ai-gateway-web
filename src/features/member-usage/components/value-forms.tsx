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

import { addReferencePrice, addUsageCost } from '../value-api'

const money = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/)
const date = z.string().refine((v) => dayjs(v).isValid())
const priceSchema = z.object({
  model: z.string().trim().min(1).max(120),
  channel_id: z.number().int().min(0),
  effective: date,
  input: money,
  output: money,
  cache_read: z.union([money, z.literal('')]),
  cache_write: z.union([money, z.literal('')]),
  cache_write_1h: z.union([money, z.literal('')]),
  source: z.string().trim().min(1).max(1000),
})
export function ReferencePriceDialog(props: {
  onClose: () => void
  onSaved: () => void
  models: string[]
}) {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      model: '',
      channel_id: 0,
      effective: dayjs().startOf('day').format('YYYY-MM-DDTHH:mm'),
      input: '',
      output: '',
      cache_read: '',
      cache_write: '',
      cache_write_1h: '',
      source: '',
    },
  })
  const mutation = useMutation({
    mutationFn: addReferencePrice,
    onSuccess: props.onSaved,
  })
  return (
    <Dialog
      open
      title={t('Add reference price version')}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      bodyClassName='space-y-4'
      footer={
        <Button
          form='reference-price'
          type='submit'
          disabled={mutation.isPending}
        >
          {t('Save')}
        </Button>
      }
    >
      <form
        id='reference-price'
        className='grid grid-cols-1 gap-4 sm:grid-cols-2'
        onSubmit={form.handleSubmit(({ effective, ...values }) =>
          mutation.mutate({ ...values, effective_at: dayjs(effective).unix() })
        )}
      >
        <div>
          <Label htmlFor='value-model'>{t('Model ID')}</Label>
          <Input
            id='value-model'
            list='value-models'
            {...form.register('model')}
          />
          <datalist id='value-models'>
            {props.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor='value-channel'>{t('Channel ID (0 = all)')}</Label>
          <Input
            id='value-channel'
            type='number'
            min={0}
            {...form.register('channel_id', { valueAsNumber: true })}
          />
        </div>
        <div className='sm:col-span-2'>
          <Label htmlFor='value-effective'>{t('Price effective time')}</Label>
          <Input
            id='value-effective'
            type='datetime-local'
            {...form.register('effective')}
          />
        </div>
        {(
          [
            ['input', 'Input CNY per million'],
            ['output', 'Output CNY per million'],
            ['cache_read', 'Cache read CNY per million'],
            ['cache_write', 'Cache write CNY per million'],
            ['cache_write_1h', 'Cache write 1h CNY per million'],
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <Label htmlFor={`price-${field}`}>{t(label)}</Label>
            <Input
              id={`price-${field}`}
              inputMode='decimal'
              {...form.register(field)}
            />
          </div>
        ))}
        <div className='sm:col-span-2'>
          <Label htmlFor='value-source'>
            {t('Price source and exchange-rate basis')}
          </Label>
          <Input
            id='value-source'
            maxLength={1000}
            {...form.register('source')}
          />
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert' className='text-destructive sm:col-span-2'>
            {t('member_usage_value_invalid_price')}
          </p>
        )}
        {mutation.isError && (
          <p role='alert' className='text-destructive sm:col-span-2'>
            {t(
              getServerErrorMessageKey(mutation.error) ||
                'member_usage_unavailable'
            )}
          </p>
        )}
      </form>
      <p className='text-muted-foreground text-xs'>{t('value_price_scope')}</p>
    </Dialog>
  )
}
const costSchema = z.object({
  category: z.enum(['upstream', 'server', 'analysis', 'other']),
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
      category: 'upstream' as const,
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
            {['upstream', 'server', 'analysis', 'other'].map((c) => (
              <option key={c} value={c}>
                {t(`value_cost_${c}`)}
              </option>
            ))}
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
