import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

import { getWorkSessions } from '../api'

export function WorkSessions() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['member-work-sessions'],
    queryFn: getWorkSessions,
    refetchInterval: 30000,
    retry: false,
  })
  const rows =
    query.data?.items.filter((row) =>
      [row.username, row.display_name, row.project, row.purpose]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    ) ?? []
  return (
    <div className='min-w-0 space-y-4 pt-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input
          className='w-full sm:w-64'
          aria-label={t('Search members or projects')}
          placeholder={t('Search members or projects')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                aria-label={t('Refresh client projects')}
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              />
            }
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
          </TooltipTrigger>
          <TooltipContent>{t('Refresh client projects')}</TooltipContent>
        </Tooltip>
        <span className='text-muted-foreground text-xs'>
          {t('Latest 100 client reports, independent of usage date range')}
        </span>
      </div>
      {query.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Client project reports unavailable')}
        </p>
      )}
      {query.isPending && <p role='status'>{t('Loading usage records...')}</p>}
      {query.data && !query.isError && (
        <div className='overflow-x-auto'>
          <Table className='min-w-[1000px] table-fixed'>
            <TableHeader>
              <TableRow>
                <TableHead className='w-36'>{t('Member')}</TableHead>
                <TableHead className='w-24'>{t('Member type')}</TableHead>
                <TableHead className='w-56'>
                  {t('Client selected project')}
                </TableHead>
                <TableHead className='w-56'>
                  {t('Member declared purpose')}
                </TableHead>
                <TableHead className='w-32'>{t('Reporting status')}</TableHead>
                <TableHead className='w-44'>{t('Report timestamps')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className='h-28 text-center'>
                    {t('No client project reports')}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => {
                let status = 'Recently reported'
                if (row.ended_at) {
                  status = 'Reporting stopped'
                } else if (
                  (query.data?.generated_at ?? 0) - row.last_seen_at >
                  (query.data?.stale_after_seconds ?? 180)
                ) {
                  status = 'Reporting interrupted'
                }
                return (
                  <TableRow
                    key={`${row.user_id}:${row.session_id}`}
                    className='[&_td]:align-top [&_td]:break-words [&_td]:whitespace-normal'
                  >
                    <TableCell>
                      {row.display_name || row.username}
                      <div className='text-muted-foreground text-xs'>
                        {row.username} · #{row.user_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      {t(`usage_type_${row.member_type || 'unspecified'}`)}
                    </TableCell>
                    <TableCell>
                      <div className='font-medium'>{row.project}</div>
                      <div className='text-muted-foreground text-xs'>
                        {row.source === 'git' ? 'Git' : t('Directory name')} ·{' '}
                        {row.branch || '-'}
                      </div>
                    </TableCell>
                    <TableCell>{row.purpose || t('Not registered')}</TableCell>
                    <TableCell>{t(status)}</TableCell>
                    <TableCell className='text-xs'>
                      <div>
                        {t('Started')}: {formatTimestamp(row.started_at)}
                      </div>
                      <div>
                        {t('Last report')}: {formatTimestamp(row.last_seen_at)}
                      </div>
                      {row.ended_at > 0 && (
                        <div>
                          {t('Stopped')}: {formatTimestamp(row.ended_at)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
