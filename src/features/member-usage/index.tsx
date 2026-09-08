import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { Archive, Info, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestamp } from '@/lib/format'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import { getUsageSummary } from './api'
import { AnalysisAssistant } from './components/analysis-assistant'
import { MemberTable, UsageStats } from './components/member-table'
import { ProfileDialog } from './components/profile-dialog'
import { ArchiveDialog, Reports } from './components/reports'
import { UsageValue } from './components/usage-value'
import { WorkSessions } from './components/work-sessions'
import { filterUsageMembers, usageDateRange } from './lib'
import type { UsageMember } from './types'

export function MemberUsage() {
  const { t } = useTranslation()
  const [from, setFrom] = useState(() =>
    dayjs().subtract(6, 'day').format('YYYY-MM-DD')
  )
  const [to, setTo] = useState(() => dayjs().format('YYYY-MM-DD'))
  const [search, setSearch] = useState('')
  const [memberType, setMemberType] = useState('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [editing, setEditing] = useState<UsageMember | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [showScope, setShowScope] = useState(false)
  const [tab, setTab] = useState('members')
  const range = usageDateRange(from, to)
  const query = useQuery({
    queryKey: ['member-usage', range?.start, range?.end],
    queryFn: () => {
      if (!range) throw new Error('member_usage_invalid_range')
      return getUsageSummary(range.start, range.end)
    },
    enabled: range !== null,
    retry: false,
  })
  const members = filterUsageMembers(
    query.data?.members ?? [],
    search,
    memberType,
    attentionOnly
  )
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Member Usage')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                aria-label={t('Statistics scope')}
                onClick={() => setShowScope(true)}
              />
            }
          >
            <Info />
          </TooltipTrigger>
          <TooltipContent>{t('Statistics scope')}</TooltipContent>
        </Tooltip>
        <Button
          disabled={!range || !query.data || query.isFetching || query.isError}
          onClick={() => setArchiving(true)}
        >
          <Archive />
          {t('Archive period report')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='min-w-0 space-y-5'>
          <div className='flex flex-wrap items-end gap-3'>
            <div className='min-w-0 space-y-1.5'>
              <Label htmlFor='usage-from'>{t('Start date')}</Label>
              <Input
                id='usage-from'
                type='date'
                className='w-40 max-w-full'
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className='min-w-0 space-y-1.5'>
              <Label htmlFor='usage-to'>{t('End date')}</Label>
              <Input
                id='usage-to'
                type='date'
                className='w-40 max-w-full'
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    disabled={!range || query.isFetching}
                    aria-label={t('Refresh')}
                    onClick={() => void query.refetch()}
                  />
                }
              >
                <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
              </TooltipTrigger>
              <TooltipContent>{t('Refresh')}</TooltipContent>
            </Tooltip>
            <span className='text-muted-foreground pb-2 text-xs'>
              {t('Browser time zone')}:{' '}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>
          {!range && (
            <p role='alert' className='text-destructive text-sm'>
              {t('member_usage_invalid_range')}
            </p>
          )}
          {range && query.isPending && (
            <div
              className='text-muted-foreground border-y py-10 text-sm'
              role='status'
            >
              {t('Loading usage records...')}
            </div>
          )}
          {query.isError && (
            <p role='alert' className='text-destructive border-y py-6 text-sm'>
              {t(
                getServerErrorMessageKey(query.error) ||
                  'member_usage_unavailable'
              )}
            </p>
          )}
          {range && query.data && !query.isError && (
            <UsageStats summary={query.data} />
          )}
          <div className='mx-auto w-full max-w-[1680px] rounded-lg border bg-background p-4 shadow-sm'>
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <TabsList
              variant='line'
              className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'
            >
              <TabsTrigger value='members'>{t('Member details')}</TabsTrigger>
              <TabsTrigger value='projects'>{t('Client projects')}</TabsTrigger>
              <TabsTrigger value='value'>{t('Usage and value')}</TabsTrigger>
              <TabsTrigger value='reports'>{t('Archived reports')}</TabsTrigger>
              <TabsTrigger value='ai'>{t('AI assistant')}</TabsTrigger>
            </TabsList>
            <TabsContent value='members' className='min-w-0 space-y-4 pt-4'>
              <div className='flex flex-wrap items-center gap-3'>
                <div className='relative w-full sm:w-64'>
                  <Search className='text-muted-foreground absolute top-2 left-2 size-4' />
                  <Input
                    className='pl-8'
                    aria-label={t('Search members or projects')}
                    placeholder={t('Search members or projects')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <select
                  className='bg-background h-8 max-w-full rounded-md border px-2 text-sm'
                  aria-label={t('Member type')}
                  value={memberType}
                  onChange={(event) => setMemberType(event.target.value)}
                >
                  <option value='all'>{t('All member types')}</option>
                  <option value='intern'>{t('usage_type_intern')}</option>
                  <option value='full_time'>{t('usage_type_full_time')}</option>
                  <option value='unspecified'>
                    {t('usage_type_unspecified')}
                  </option>
                </select>
                <label className='flex items-center gap-2 text-sm'>
                  <input
                    type='checkbox'
                    checked={attentionOnly}
                    onChange={(event) => setAttentionOnly(event.target.checked)}
                  />
                  {t('Needs review only')}
                </label>
              </div>
              {range && query.data && !query.isError && (
                <>
                  <MemberTable members={members} onEdit={setEditing} />
                  <div className='text-muted-foreground flex flex-wrap justify-between gap-2 text-xs'>
                    <span>
                      {t('Matching members')}: {members.length} /{' '}
                      {query.data.members.length}
                    </span>
                    <span>
                      {t('Data as of')}:{' '}
                      {formatTimestamp(query.data.generated_at)}
                    </span>
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value='reports'>
              <Reports />
            </TabsContent>
            <TabsContent value='projects'>
              <WorkSessions />
            </TabsContent>
            <TabsContent value='value'>
              <UsageValue range={range} />
            </TabsContent>
            <TabsContent value='ai'>
              <AnalysisAssistant
                range={range}
                members={query.data?.members ?? []}
              />
            </TabsContent>
          </Tabs>
          </div>
        </div>
        {editing && (
          <ProfileDialog
            key={editing.user_id}
            member={editing}
            onClose={() => setEditing(null)}
          />
        )}
        {archiving && range && (
          <ArchiveDialog
            start={range.start}
            end={range.end}
            onClose={() => setArchiving(false)}
          />
        )}
        <Dialog
          open={showScope}
          onOpenChange={setShowScope}
          title={t('Statistics scope')}
          bodyClassName='space-y-4 text-sm'
        >
          <p>{t('usage_scope_records')}</p>
          <p>{t('usage_scope_attribution')}</p>
          <p>{t('usage_scope_signals')}</p>
          <p>{t('usage_scope_privacy')}</p>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
