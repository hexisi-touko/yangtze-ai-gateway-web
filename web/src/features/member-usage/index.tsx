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
import { RequestContents } from './components/request-contents'
import { UsageValue } from './components/usage-value'
import { filterUsageMembers, usageDateRange } from './lib'
import type { UsageMember } from './types'

const memberUsageTabTooltipClass =
  'border-border !bg-popover !text-popover-foreground shadow-md'
const memberUsageTabDescriptions = {
  ai: '调用已配置的分析服务，辅助解读成员使用数据。',
  members: '查看成员分类、工作区域、密钥使用情况和关键指标。',
  reports: '查看已归档的月度报告和成员用量汇总。',
  requests: '查看所选时间范围内各成员采集到的请求内容。',
  value: '对比 Token 用量、官方参考价值、分配额度和节省开支。',
} as const

export function MemberUsage() {
  const { t } = useTranslation()
  const [from, setFrom] = useState(() =>
    dayjs().startOf('month').format('YYYY-MM-DD')
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
          <TooltipContent
            className={`${memberUsageTabTooltipClass} text-center`}
            arrowClassName='!bg-popover !fill-popover'
          >
            {t('Statistics scope')}
          </TooltipContent>
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
        <div className='member-usage-page min-w-0 space-y-4'>
          <div className='member-usage-toolbar bg-card flex flex-wrap items-end gap-3 rounded-lg border p-3 shadow-xs sm:p-4'>
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
              <TooltipContent
                className={`${memberUsageTabTooltipClass} text-center`}
                arrowClassName='!bg-popover !fill-popover'
              >
                {t('Refresh')}
              </TooltipContent>
            </Tooltip>
            <span className='text-muted-foreground ml-auto pb-2 text-xs'>
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
              className='text-muted-foreground bg-card rounded-lg border py-10 text-center text-sm'
              role='status'
            >
              {t('Loading usage records...')}
            </div>
          )}
          {query.isError && (
            <p
              role='alert'
              className='text-destructive bg-card rounded-lg border px-4 py-6 text-sm'
            >
              {t(
                getServerErrorMessageKey(query.error) ||
                  'member_usage_unavailable'
              )}
            </p>
          )}
          {range && query.data && !query.isError && (
            <UsageStats summary={query.data} />
          )}
          <div className='member-usage-surface bg-card mx-auto w-full max-w-[1680px] rounded-lg border p-3 shadow-xs sm:p-4'>
            <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
              <TabsList
                variant='line'
                className='member-usage-tabs max-w-full justify-start gap-3 overflow-x-auto px-1 group-data-horizontal/tabs:h-auto sm:gap-4'
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value='members'
                        className='shrink-0 px-3.5 sm:px-4'
                      >
                        {t('Member details')}
                      </TabsTrigger>
                    }
                  />
                  <TooltipContent
                    className={`${memberUsageTabTooltipClass} max-w-72 text-center`}
                    arrowClassName='!bg-popover !fill-popover'
                  >
                    {memberUsageTabDescriptions.members}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value='value'
                        className='shrink-0 px-3.5 sm:px-4'
                      >
                        {t('Usage and value')}
                      </TabsTrigger>
                    }
                  />
                  <TooltipContent
                    className={`${memberUsageTabTooltipClass} max-w-72 text-center`}
                    arrowClassName='!bg-popover !fill-popover'
                  >
                    {memberUsageTabDescriptions.value}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value='request-contents'
                        className='shrink-0 px-3.5 sm:px-4'
                      >
                        {t('Daily member requests')}
                      </TabsTrigger>
                    }
                  />
                  <TooltipContent
                    className={`${memberUsageTabTooltipClass} max-w-72 text-center`}
                    arrowClassName='!bg-popover !fill-popover'
                  >
                    {memberUsageTabDescriptions.requests}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value='reports'
                        className='shrink-0 px-3.5 sm:px-4'
                      >
                        {t('Archived reports')}
                      </TabsTrigger>
                    }
                  />
                  <TooltipContent
                    className={`${memberUsageTabTooltipClass} max-w-72 text-center`}
                    arrowClassName='!bg-popover !fill-popover'
                  >
                    {memberUsageTabDescriptions.reports}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value='ai'
                        className='shrink-0 px-3.5 sm:px-4'
                      >
                        {t('AI assistant')}
                      </TabsTrigger>
                    }
                  />
                  <TooltipContent
                    className={`${memberUsageTabTooltipClass} max-w-72 text-center`}
                    arrowClassName='!bg-popover !fill-popover'
                  >
                    {memberUsageTabDescriptions.ai}
                  </TooltipContent>
                </Tooltip>
              </TabsList>
              <TabsContent value='members' className='min-w-0 space-y-4 pt-4'>
                <div className='member-usage-filters bg-muted/25 flex flex-wrap items-center gap-3 rounded-md border p-3'>
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
                    <option value='full_time'>
                      {t('usage_type_full_time')}
                    </option>
                    <option value='other'>{t('usage_type_other')}</option>
                    <option value='unspecified'>
                      {t('usage_type_unspecified')}
                    </option>
                  </select>
                  <label className='flex items-center gap-2 text-sm'>
                    <input
                      type='checkbox'
                      checked={attentionOnly}
                      onChange={(event) =>
                        setAttentionOnly(event.target.checked)
                      }
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
              <TabsContent value='value'>
                <UsageValue range={range} />
              </TabsContent>
              <TabsContent value='request-contents'>
                <RequestContents
                  range={range}
                  members={query.data?.members ?? []}
                />
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
