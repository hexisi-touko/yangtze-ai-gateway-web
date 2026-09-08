import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Download, Eye } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatTimestamp } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { archiveUsageReport, getUsageReport, getUsageReports } from '../api'
import { exportUsageJSON } from '../lib'
import type { UsageReport, UsageSummary } from '../types'
import type { ValueSummary } from '../value-api'
import { MemberTable, UsageStats } from './member-table'
import { ValueOverview } from './value-overview'

const reportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000),
})

export function ArchiveDialog(props: {
  start: number
  end: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm({
    resolver: zodResolver(reportSchema),
    defaultValues: { title: '', note: '' },
  })
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof reportSchema>) =>
      archiveUsageReport({
        ...values,
        start_time: props.start,
        end_time: props.end,
      }),
    onSuccess: () => {
      toast.success(t('Report archived'))
      void client.invalidateQueries({ queryKey: ['member-usage-reports'] })
      props.onClose()
    },
    onError: handleServerError,
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={t('Archive period report')}
      description={`${formatTimestamp(props.start)} - ${formatTimestamp(props.end - 1)}`}
      bodyClassName='space-y-4'
      footer={
        <Button type='submit' form='usage-report' disabled={mutation.isPending}>
          <Archive />
          {t('Confirm archive')}
        </Button>
      }
    >
      <form
        id='usage-report'
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className='space-y-2'>
          <Label htmlFor='report-title'>{t('Report title')}</Label>
          <Input
            id='report-title'
            maxLength={120}
            aria-required
            {...form.register('title')}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='report-note'>{t('Administrator summary')}</Label>
          <Textarea
            id='report-note'
            rows={5}
            maxLength={2000}
            {...form.register('note')}
          />
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert' className='text-destructive'>
            {t('member_usage_invalid_report')}
          </p>
        )}
        {mutation.isError && (
          <p role='alert' className='text-destructive'>
            {t('Report was not archived')}
          </p>
        )}
      </form>
      <p className='text-muted-foreground text-xs'>
        {t('usage_archive_scope')}
      </p>
    </Dialog>
  )
}

function ReportDetail(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['member-usage-report', props.id],
    queryFn: () => getUsageReport(props.id),
  })
  let snapshot: UsageSummary | null = null
  let valueSnapshot: ValueSummary | null = null
  if (query.data?.value_snapshot) {
    try {
      valueSnapshot = JSON.parse(query.data.value_snapshot) as ValueSummary
    } catch {
      valueSnapshot = null
    }
  }
  if (query.data?.snapshot) {
    try {
      snapshot = JSON.parse(query.data.snapshot) as UsageSummary
    } catch {
      snapshot = null
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={query.data?.title || t('Archived report')}
      contentClassName='sm:max-w-6xl'
      titleClassName='break-all'
      footer={
        <Button
          variant='outline'
          disabled={!query.data}
          onClick={() =>
            exportUsageJSON(query.data, `member-usage-report-${props.id}.json`)
          }
        >
          <Download />
          {t('Export JSON')}
        </Button>
      }
    >
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {(query.isError || (query.isSuccess && !snapshot)) && (
        <p role='alert'>{t('member_usage_unavailable')}</p>
      )}
      {query.data && snapshot && (
        <div className='space-y-5'>
          <p className='text-muted-foreground text-sm'>
            {formatTimestamp(query.data.start_time)} -{' '}
            {formatTimestamp(query.data.end_time - 1)}
          </p>
          <p className='text-sm break-words whitespace-pre-wrap'>
            {query.data.note || t('No administrator summary')}
          </p>
          <UsageStats summary={snapshot} />
          <MemberTable members={snapshot.members} />
          {valueSnapshot ? (
            <ValueOverview data={valueSnapshot} />
          ) : (
            <p className='text-muted-foreground text-xs'>
              {t('No value snapshot in this historical report')}
            </p>
          )}
          <p className='text-muted-foreground text-xs'>
            {t('Archived at')}: {formatTimestamp(query.data.created_at)} ·{' '}
            {t('Administrator')} #{query.data.created_by}
          </p>
        </div>
      )}
    </Dialog>
  )
}

export function Reports() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<UsageReport | null>(null)
  const query = useQuery({
    queryKey: ['member-usage-reports'],
    queryFn: getUsageReports,
  })
  return (
    <div className='space-y-4 py-4'>
      <h3 className='text-sm font-medium'>
        {t('Recent 100 archived reports')}
      </h3>
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <div role='alert'>
          <p>{t('member_usage_unavailable')}</p>
          <Button variant='outline' onClick={() => void query.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      )}
      {query.data?.length === 0 && (
        <div className='text-muted-foreground border-y py-16 text-center'>
          <Archive className='mx-auto mb-3 size-7' />
          <p>{t('No archived reports')}</p>
        </div>
      )}
      <div className='divide-y'>
        {query.data?.map((report) => (
          <div
            key={report.id}
            className='flex items-start justify-between gap-4 py-4'
          >
            <div className='min-w-0'>
              <h4 className='text-sm font-medium break-words'>
                {report.title}
              </h4>
              <p className='text-muted-foreground mt-1 text-xs'>
                {formatTimestamp(report.start_time)} -{' '}
                {formatTimestamp(report.end_time - 1)}
              </p>
              <p className='text-muted-foreground mt-2 text-xs'>
                {t('Archived at')}: {formatTimestamp(report.created_at)}
              </p>
            </div>
            <Button variant='outline' onClick={() => setSelected(report)}>
              <Eye />
              {t('View')}
            </Button>
          </div>
        ))}
      </div>
      {selected && (
        <ReportDetail id={selected.id} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
