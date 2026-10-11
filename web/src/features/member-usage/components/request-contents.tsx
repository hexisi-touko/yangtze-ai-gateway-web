import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { Eye, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimestamp } from '@/lib/format'

import {
  getMemberRequestContentAlerts,
  getMemberRequestContentsPage,
} from '../api'
import type {
  MemberRequestContent,
  MemberRequestContentAlert,
  UsageMember,
} from '../types'

export function RequestContents(props: {
  range: { start: number; end: number } | null
  members: UsageMember[]
}) {
  const { t } = useTranslation()
  const [userID, setUserID] = useState('')
  const [selected, setSelected] = useState<MemberRequestContent | null>(null)
  const parsedUserID = Number(userID)
  const query = useInfiniteQuery({
    queryKey: [
      'member-request-contents',
      props.range?.start,
      props.range?.end,
      parsedUserID || 0,
    ],
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: Awaited<ReturnType<typeof getMemberRequestContentsPage>>
    ) => (lastPage.has_more ? lastPage.next_cursor : undefined),
    queryFn: ({ pageParam }) => {
      if (!props.range) throw new Error('member_usage_invalid_range')
      return getMemberRequestContentsPage({
        start: props.range.start,
        end: props.range.end,
        user_id: parsedUserID > 0 ? parsedUserID : undefined,
        before_id: pageParam,
      })
    },
    enabled: !!props.range,
    retry: false,
  })
  const alertsQuery = useQuery({
    queryKey: [
      'member-request-content-alerts',
      props.range?.start,
      props.range?.end,
      parsedUserID || 0,
    ],
    queryFn: () => {
      if (!props.range) throw new Error('member_usage_invalid_range')
      return getMemberRequestContentAlerts({
        start: props.range.start,
        end: props.range.end,
        user_id: parsedUserID > 0 ? parsedUserID : undefined,
        limit: 50,
      })
    },
    enabled: !!props.range,
    retry: false,
  })
  return (
    <section className='min-w-0 space-y-4 py-4'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='min-w-56 space-y-1.5'>
          <Label htmlFor='request-content-member'>{t('Member')}</Label>
          <select
            id='request-content-member'
            className='bg-background h-9 w-full rounded-md border px-2 text-sm'
            value={userID}
            onChange={(event) => setUserID(event.target.value)}
          >
            <option value=''>{t('All members')}</option>
            {props.members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name || member.username || `#${member.user_id}`}{' '}
                #{member.user_id}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant='outline'
          size='icon'
          title={t('Refresh')}
          aria-label={t('Refresh request contents')}
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
            void alertsQuery.refetch()
          }}
        >
          <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
        </Button>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t('request_content_scope')}
      </p>
      {alertsQuery.data && alertsQuery.data.length > 0 && (
        <RequestContentAlerts alerts={alertsQuery.data} />
      )}
      {alertsQuery.isError && (
        <p className='text-muted-foreground text-xs'>
          {t('Request alert data unavailable')}
        </p>
      )}
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <p role='alert' className='text-destructive'>
          {t('member_usage_unavailable')}
        </p>
      )}
      {query.data && (
        <>
          <MemberRequestTree
            items={query.data.pages.flatMap((page) => page.items)}
            onSelect={setSelected}
          />
          {query.hasNextPage && (
            <Button
              variant='outline'
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t(
                query.isFetchingNextPage
                  ? 'Loading...'
                  : 'Load earlier requests'
              )}
            </Button>
          )}
        </>
      )}
      {selected && (
        <Dialog
          open
          title={t('Member request content')}
          description={`${selected.username || `#${selected.user_id}`} · ${formatTimestamp(selected.created_at)}`}
          contentClassName='sm:max-w-5xl'
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
        >
          <div className='space-y-3'>
            <p className='text-muted-foreground text-xs break-all'>
              {t('Request hash')}: {selected.content_hash} · {t('Request ID')}:{' '}
              {selected.request_id || '-'}
            </p>
            {selected.truncated && (
              <p role='status' className='text-muted-foreground text-sm'>
                {t(
                  'This historical request was truncated when captured; missing text cannot be restored.'
                )}
              </p>
            )}
            <RequestConversation content={selected.content} />
          </div>
        </Dialog>
      )}
    </section>
  )
}

type ConversationMessage = {
  role: string
  text: string
  system: boolean
}

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromValue(item))
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    for (const key of [
      'text',
      'content',
      'input_text',
      'output_text',
      'value',
    ]) {
      if (item[key] !== undefined) {
        const text = textFromValue(item[key])
        if (text) return text
      }
    }
  }
  return ''
}

function messagesFromValue(
  value: unknown,
  roleHint = ''
): ConversationMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const text = textFromValue(
      row.content ?? row.input ?? row.text ?? row.parts
    )
    if (!text) return []
    const explicitRole = typeof row.role === 'string' ? row.role : roleHint
    // Responses clients occasionally omit the role on the first input item;
    // the harness system prompt is still recognizable and should not obscure
    // the member's actual messages in the administrator view.
    const role =
      explicitRole ||
      (/^(you are an ai assistant|system message|developer instructions?)/i.test(
        text.trim()
      )
        ? 'system'
        : 'request')
    return [{ role, text, system: role === 'system' || role === 'developer' }]
  })
}

function extractConversation(content: string): ConversationMessage[] {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return content.trim()
      ? [{ role: 'request', text: content, system: false }]
      : []
  }
  if (!value || typeof value !== 'object') {
    const text = textFromValue(value)
    return text ? [{ role: 'request', text, system: false }] : []
  }
  const body = value as Record<string, unknown>
  const directContent = textFromValue(body.content)
  if (directContent) {
    const role = typeof body.role === 'string' ? body.role : 'request'
    return [
      {
        role,
        text: directContent,
        system: role === 'system' || role === 'developer',
      },
    ]
  }
  const direct = [
    ...messagesFromValue(body.messages),
    ...messagesFromValue(body.input),
    ...messagesFromValue(body.contents),
  ]
  if (direct.length) return direct
  // `instruction` is commonly the harness/system prompt; only expose fields
  // that conventionally represent the member's submitted request.
  for (const key of ['prompt', 'query', 'text', 'input']) {
    const text = textFromValue(body[key])
    if (
      text &&
      !/^(you are an ai assistant|system message|developer instructions?)/i.test(
        text.trim()
      )
    ) {
      return [{ role: key, text, system: false }]
    }
  }
  return []
}

function isInternalHarnessMessage(text: string): boolean {
  const normalized = text.trim().replaceAll(/\s+/g, ' ')
  return (
    /^(?:background (?:subagent|agent) [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} finished and will do no further work\b|agent [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} sent a message:)/i.test(
      normalized
    ) ||
    normalized ===
      'You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again; if the task is not complete, try a different approach or different arguments instead of repeating the call.'
  )
}

function RequestConversation({ content }: { content: string }) {
  const { t } = useTranslation()
  const messages = extractConversation(content)
  // The administrator view is intentionally limited to member-authored
  // requests. System/developer prompts and transport metadata are not useful
  // for the work review and should never be rendered here.
  const visible = messages.filter((message) => {
    if (message.system) return false
    if (
      ['system', 'developer', 'assistant', 'tool'].includes(
        message.role.toLowerCase()
      )
    ) {
      return false
    }
    if (isInternalHarnessMessage(message.text)) return false
    return true
  })
  // Each stored body may include the complete conversation history. The last
  // visible member turn is the request associated with the selected log row;
  // rendering earlier turns here made every row look like the full period.
  const lastMessage = visible.at(-1)
  const currentRequest = lastMessage ? [lastMessage] : []
  const emptyMessage = messages.length
    ? t('Conversation content hidden')
    : t('Conversation content unavailable')
  return (
    <div className='space-y-3'>
      <div className='rounded-md border'>
        <div className='border-b px-3 py-2 text-sm font-medium'>
          {t('Conversation content')}
        </div>
        {currentRequest.length ? (
          <div className='divide-y'>
            {currentRequest.map((message) => (
              <div
                key={`${message.role}-${message.text}`}
                className='space-y-1 px-3 py-3'
              >
                <div className='text-muted-foreground text-xs'>
                  {t('Member request')}
                </div>
                <div className='text-sm break-words whitespace-pre-wrap'>
                  {message.text}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className='text-muted-foreground px-3 py-4 text-sm'>
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}

type MemberRequestDay = {
  date: string
  items: MemberRequestContent[]
}

type MemberRequestGroup = {
  userId: number
  username: string
  days: MemberRequestDay[]
  count: number
}

function groupRequestContents(
  items: MemberRequestContent[]
): MemberRequestGroup[] {
  const byMember = new Map<
    number,
    { username: string; days: Map<string, MemberRequestContent[]> }
  >()
  for (const item of items) {
    const member = byMember.get(item.user_id) ?? {
      username: item.username,
      days: new Map<string, MemberRequestContent[]>(),
    }
    const day = dayjs.unix(item.created_at).format('YYYY-MM-DD')
    const entries = member.days.get(day) ?? []
    entries.push(item)
    member.days.set(day, entries)
    if (!member.username && item.username) member.username = item.username
    byMember.set(item.user_id, member)
  }
  return [...byMember.entries()]
    .map(([userId, member]) => {
      const days = [...member.days.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, dayItems]) => ({
          date,
          items: dayItems.sort((a, b) => b.created_at - a.created_at),
        }))
      return {
        userId,
        username: member.username,
        days,
        count: days.reduce((total, day) => total + day.items.length, 0),
      }
    })
    .sort((a, b) =>
      (a.username || `#${a.userId}`).localeCompare(b.username || `#${b.userId}`)
    )
}

function MemberRequestTree(props: {
  items: MemberRequestContent[]
  onSelect: (item: MemberRequestContent) => void
}) {
  const { t } = useTranslation()
  const groups = groupRequestContents(props.items)
  if (groups.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border py-12 text-center text-sm'>
        {t('No request contents')}
      </div>
    )
  }
  return (
    <div className='space-y-3'>
      {groups.map((member, memberIndex) => (
        <details
          key={member.userId}
          open={groups.length === 1 || memberIndex === 0}
          className='overflow-hidden rounded-lg border'
        >
          <summary className='hover:bg-muted/40 flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden'>
            <div className='min-w-0'>
              <div className='font-medium break-all'>
                {member.username || `#${member.userId}`}
              </div>
              <div className='text-muted-foreground text-xs'>
                #{member.userId} · {member.days.length} {t('request days')}
              </div>
            </div>
            <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
              {member.count.toLocaleString()} {t('Requests')}
            </span>
          </summary>
          <div className='divide-y border-t'>
            {member.days.map((day, dayIndex) => (
              <details key={day.date} open={dayIndex === 0}>
                <summary className='hover:bg-muted/30 flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden'>
                  <span>{day.date}</span>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {day.items.length.toLocaleString()} {t('Requests')}
                  </span>
                </summary>
                <div className='overflow-x-auto border-t'>
                  <Table className='min-w-[820px] table-fixed'>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-44'>{t('Time')}</TableHead>
                        <TableHead className='w-48'>
                          {t('Model / route')}
                        </TableHead>
                        <TableHead className='w-28 text-right'>
                          {t('Original size')}
                        </TableHead>
                        <TableHead className='w-28'>
                          {t('Storage status')}
                        </TableHead>
                        <TableHead className='w-20'>
                          <span className='sr-only'>{t('View')}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {day.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            {formatTimestamp(item.created_at)}
                          </TableCell>
                          <TableCell className='break-all whitespace-normal'>
                            <div>{item.model || '-'}</div>
                            <div className='text-muted-foreground text-xs'>
                              {item.path}
                            </div>
                          </TableCell>
                          <TableCell className='text-right'>
                            {item.bytes.toLocaleString()} B
                          </TableCell>
                          <TableCell>
                            {item.truncated
                              ? t('Redacted and truncated')
                              : t('Redacted copy')}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant='ghost'
                              size='icon'
                              title={t('View')}
                              aria-label={t('View request content')}
                              onClick={() => props.onSelect(item)}
                            >
                              <Eye />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

function RequestContentAlerts(props: { alerts: MemberRequestContentAlert[] }) {
  const { t } = useTranslation()
  return (
    <div className='min-w-0 overflow-x-auto border border-amber-500/40 bg-amber-500/5'>
      <div className='border-b px-3 py-2 text-sm font-medium'>
        {t('Repeated request review')}
      </div>
      <p className='text-muted-foreground px-3 py-2 text-xs'>
        {t('request_repeat_alert_scope')}
      </p>
      <Table className='min-w-[760px] table-fixed'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-40'>{t('Member')}</TableHead>
            <TableHead className='w-44'>{t('Model')}</TableHead>
            <TableHead className='w-32 text-right'>
              {t('Repeat count')}
            </TableHead>
            <TableHead>{t('First / last seen')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.alerts.map((alert) => (
            <TableRow key={`${alert.user_id}:${alert.content_hash}`}>
              <TableCell className='break-all whitespace-normal'>
                {alert.username || `#${alert.user_id}`} · #{alert.user_id}
              </TableCell>
              <TableCell className='break-all whitespace-normal'>
                {alert.model || '-'}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {alert.repeat_count.toLocaleString()}
              </TableCell>
              <TableCell className='text-xs'>
                {formatTimestamp(alert.first_seen_at)}{' '}
                <span className='text-muted-foreground'>/</span>{' '}
                {formatTimestamp(alert.last_seen_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
