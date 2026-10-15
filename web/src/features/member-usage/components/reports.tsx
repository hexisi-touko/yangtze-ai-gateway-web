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

import {
  type RequestArchive,
  archiveUsageReport,
  getUsageReport,
  getUsageReports,
  normalizeUsageSummary,
  downloadMemberDocument,
  rebuildRequestArchive,
} from '../api'
import { buildReadableReportExport, exportUsageJSON } from '../lib'
import type { UsageReport, UsageSummary } from '../types'

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
  const client = useQueryClient()
  const rebuild = useMutation({
    mutationFn: () => rebuildRequestArchive(props.id),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['member-usage-report', props.id],
      })
    },
    onError: handleServerError,
  })
  const download = useMutation({
    mutationFn: (userID: number) => downloadMemberDocument(props.id, userID),
    onError: handleServerError,
  })
  let archive: RequestArchive | null = null
  if (query.data?.request_archive) {
    try {
      const parsed = JSON.parse(query.data.request_archive) as RequestArchive
      if (parsed.version === 1 && Array.isArray(parsed.members)) {
        archive = parsed
      }
    } catch {
      archive = null
    }
  }
  let snapshot: UsageSummary | null = null
  if (query.data?.snapshot) {
    try {
      snapshot = normalizeUsageSummary(
        JSON.parse(query.data.snapshot) as Partial<UsageSummary>
      )
    } catch {
      snapshot = null
    }
  }
  const historicalSummary = snapshot
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
            query.data &&
            exportUsageJSON(
              buildReadableReportExport(query.data, historicalSummary, archive),
              `member-usage-report-${props.id}.json`
            )
          }
        >
          <Download />
          {t('Export JSON')}
        </Button>
      }
    >
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && <p role='alert'>{t('member_usage_unavailable')}</p>}
      {query.isSuccess && !snapshot && (
        <p role='alert'>{t('Historical report details unavailable')}</p>
      )}
      {query.data && historicalSummary && (
        <div className='space-y-5'>
          <p className='text-muted-foreground text-sm'>
            {formatTimestamp(query.data.start_time)} -{' '}
            {formatTimestamp(query.data.end_time - 1)}
          </p>
          <p className='text-sm break-words whitespace-pre-wrap'>
            {query.data.note || t('No administrator summary')}
          </p>
          <MonthlyMemberUsage members={historicalSummary.members ?? []} />
          <section className='space-y-3 border-t pt-4'>
            <h3 className='text-sm font-medium'>
              {t('Member monthly request documents')}
            </h3>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Documents group captured member requests by date in Beijing time. AI replies are not included.'
              )}
            </p>
            {!archive && (
              <div className='space-y-2'>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'This older report contains statistics only. Rebuild documents from requests that still exist; deleted text cannot be recovered.'
                  )}
                </p>
                <Button
                  variant='outline'
                  disabled={rebuild.isPending}
                  onClick={() => rebuild.mutate()}
                >
                  {t(
                    rebuild.isPending
                      ? 'Loading...'
                      : 'Rebuild request documents'
                  )}
                </Button>
              </div>
            )}
            {archive?.rebuilt && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Rebuilt from remaining historical records; this is not a guarantee of complete conversation history.'
                )}
              </p>
            )}
            {archive?.members.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                {t('No captured requests in this archive')}
              </p>
            )}
            <div className='divide-y'>
              {archive?.members.map((member) => (
                <div
                  key={member.user_id}
                  className='flex flex-wrap items-center justify-between gap-3 py-3'
                >
                  <div>
                    <div className='text-sm font-medium'>
                      {member.display_name ||
                        member.username ||
                        `#${member.user_id}`}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      #{member.user_id} · {member.username || '-'} ·{' '}
                      {member.records.toLocaleString()} {t('Requests')}
                    </div>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={download.isPending}
                    onClick={() => download.mutate(member.user_id)}
                  >
                    <Download />
                    {t('Export member document')}
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <p className='text-muted-foreground text-xs'>
            {t('Archived at')}: {formatTimestamp(query.data.created_at)} ·{' '}
            {t('Administrator')} #{query.data.created_by}
          </p>
        </div>
      )}
    </Dialog>
  )
}

function MonthlyMemberUsage(props: { members: UsageSummary['members'] }) {
  const { t } = useTranslation()
  return (
    <section className='min-w-0 space-y-3'>
      <h3 className='text-sm font-medium'>{t('Monthly member usage')}</h3>
      <div className='min-w-0 overflow-x-auto rounded-lg border'>
        <table className='w-full min-w-[720px] text-sm'>
          <thead className='bg-muted/40 text-left'>
            <tr className='border-b'>
              <th className='px-3 py-2'>{t('Member')}</th>
              <th className='px-3 py-2'>{t('Member type')}</th>
              <th className='px-3 py-2'>{t('Current client workspace')}</th>
              <th className='px-3 py-2 text-right'>{t('Requests')}</th>
              <th className='px-3 py-2 text-right'>{t('Tokens')}</th>
              <th className='px-3 py-2 text-right'>{t('Cache hit rate')}</th>
            </tr>
          </thead>
          <tbody>
            {props.members.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className='text-muted-foreground px-3 py-10 text-center'
                >
                  {t('No matching members')}
                </td>
              </tr>
            )}
            {props.members.map((member) => (
              <tr key={member.user_id} className='border-b last:border-b-0'>
                <td className='px-3 py-3 align-top'>
                  <div className='font-medium'>
                    {member.display_name ||
                      member.username ||
                      `#${member.user_id}`}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {member.username} · #{member.user_id}
                  </div>
                </td>
                <td className='px-3 py-3 align-top'>
                  {t(`usage_type_${member.profile.member_type}`)}
                </td>
                <td className='px-3 py-3 align-top break-words'>
                  {member.workspace_project || t('No workspace reported')}
                </td>
                <td className='px-3 py-3 text-right align-top tabular-nums'>
                  {(
                    member.consume_records + member.error_records
                  ).toLocaleString()}
                </td>
                <td className='px-3 py-3 text-right align-top tabular-nums'>
                  {member.tokens.toLocaleString()}
                </td>
                <td className='px-3 py-3 text-right align-top tabular-nums'>
                  {(member.cache_eligible_input ?? 0) > 0
                    ? `${((member.cache_hit_rate ?? 0) * 100).toFixed(1)}%`
                    : t('No cache data')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Reports() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<UsageReport | null>(null)
  const query = useQuery({
    queryKey: ['member-usage-reports'],
    queryFn: getUsageReports,
  })
  const monthlyReports = (query.data ?? []).filter(
    (report) => report.end_time - report.start_time >= 27 * 86400
  )
  return (
    <div className='space-y-4 py-4'>
      <h3 className='text-sm font-medium'>{t('Monthly usage archives')}</h3>
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <div role='alert'>
          <p>{t('member_usage_unavailable')}</p>
          <Button variant='outline' onClick={() => void query.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      )}
      {query.data && monthlyReports.length === 0 && (
        <div className='text-muted-foreground border-y py-16 text-center'>
          <Archive className='mx-auto mb-3 size-7' />
          <p>{t('No archived reports')}</p>
        </div>
      )}
      <div className='divide-y'>
        {monthlyReports.map((report) => (
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
