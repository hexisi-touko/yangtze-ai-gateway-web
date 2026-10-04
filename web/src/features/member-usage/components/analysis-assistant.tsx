import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Loader2, Plus, Send, Settings, Unplug } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatTimestamp } from '@/lib/format'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import {
  chatAnalysis,
  getAnalysis,
  getAnalysisConfig,
  listAnalysis,
  previewAnalysis,
  testAnalysis,
  type AnalysisMessage,
  type AnalysisRun,
} from '../ai-api'
import type { UsageMember } from '../types'
import { AnalysisSettings } from './analysis-settings'

export function AnalysisAssistant(props: {
  range: { start: number; end: number } | null
  members: UsageMember[]
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const config = useQuery({
    queryKey: ['analysis-config'],
    queryFn: getAnalysisConfig,
    retry: false,
  })
  const history = useQuery({
    queryKey: ['analysis-history'],
    queryFn: listAnalysis,
    retry: false,
  })
  const [settings, setSettings] = useState(false)
  const [memberID, setMemberID] = useState(0)
  const [run, setRun] = useState<AnalysisRun | null>(null)
  const [question, setQuestion] = useState('')
  const [consent, setConsent] = useState(false)
  const [consentVersion, setConsentVersion] = useState<number | null>(null)
  const [error, setError] = useState('')
  const preview = useMutation({
    mutationFn: previewAnalysis,
    onSuccess: (value) => {
      setRun(value)
      setConsent(false)
      setError('')
    },
    onError: (e) =>
      setError(getServerErrorMessageKey(e) || 'member_usage_unavailable'),
  })
  const load = useMutation({
    mutationFn: getAnalysis,
    onSuccess: (value) => {
      setRun(value)
      setConsent(false)
      setError('')
    },
    onError: (e) =>
      setError(getServerErrorMessageKey(e) || 'member_usage_unavailable'),
  })
  const chat = useMutation({
    mutationFn: chatAnalysis,
    onSuccess: (value) => {
      setRun(value)
      setQuestion('')
      setError('')
      void client.invalidateQueries({ queryKey: ['analysis-history'] })
    },
    onError: (e) =>
      setError(getServerErrorMessageKey(e) || 'member_usage_ai_upstream_error'),
  })
  const test = useMutation({ mutationFn: testAnalysis })
  const busy = preview.isPending || load.isPending || chat.isPending
  const messages: AnalysisMessage[] = run?.messages
    ? JSON.parse(run.messages)
    : []
  const configured = !!config.data?.has_key
  const canSend =
    !!run &&
    configured &&
    consent &&
    consentVersion === config.data?.version &&
    question.trim().length > 0 &&
    messages.length < 12 &&
    !busy

  return (
    <section className='min-w-0 space-y-4 py-4'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b pb-4'>
        <div className='flex min-w-0 items-center gap-2'>
          <Bot className='size-5 shrink-0' />
          <h2 className='text-base font-semibold'>{t('AI assistant')}</h2>
          <span className='text-muted-foreground truncate text-xs'>
            {configured
              ? config.data?.model
              : t('Analysis service not connected')}
          </span>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={!config.data || busy}
            onClick={() => setSettings(true)}
          >
            <Settings />
            {t('Analysis service')}
          </Button>
          <Button
            variant='outline'
            disabled={!configured || test.isPending || busy}
            onClick={() => test.mutate()}
          >
            <Unplug />
            {t('Test connection')}
          </Button>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => {
              setRun(null)
              setConsent(false)
              setQuestion('')
              setError('')
              chat.reset()
            }}
          >
            <Plus />
            {t('New analysis')}
          </Button>
        </div>
      </div>
      {config.isError && (
        <p role='alert' className='text-destructive'>
          {t(
            getServerErrorMessageKey(config.error) || 'member_usage_unavailable'
          )}
        </p>
      )}
      {test.isPending && <p role='status'>{t('Testing connection...')}</p>}
      {test.isSuccess && (
        <p role='status'>{t('Analysis connection succeeded')}</p>
      )}
      {test.isError && (
        <p role='alert' className='text-destructive'>
          {t(
            getServerErrorMessageKey(test.error) ||
              'member_usage_ai_upstream_error'
          )}
        </p>
      )}
      <div className='grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]'>
        <aside className='min-w-0 space-y-3 lg:border-r lg:pr-4'>
          <h3 className='text-sm font-medium'>{t('Analysis history')}</h3>
          {history.isPending && <p role='status'>{t('Loading...')}</p>}
          {history.isError && (
            <p role='alert'>{t('member_usage_unavailable')}</p>
          )}
          {history.data?.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t('No analysis yet')}
            </p>
          )}
          <div className='max-h-96 space-y-1 overflow-y-auto'>
            {history.data?.map((item) => (
              <button
                type='button'
                key={item.id}
                disabled={busy}
                className='hover:bg-muted block w-full min-w-0 rounded px-2 py-2 text-left text-sm disabled:opacity-50'
                onClick={() => load.mutate(item.id)}
              >
                <span className='block truncate'>{item.question}</span>
                <span className='text-muted-foreground text-xs'>
                  {formatTimestamp(item.created_at)}
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div className='min-w-0 space-y-4'>
          {!run && (
            <div className='flex flex-wrap items-end gap-3'>
              <div className='min-w-0 space-y-2'>
                <Label htmlFor='analysis-member'>{t('Analysis member')}</Label>
                <select
                  id='analysis-member'
                  className='bg-background h-9 w-full max-w-72 rounded-md border px-2 text-sm'
                  value={memberID}
                  disabled={busy}
                  onChange={(e) => setMemberID(Number(e.target.value))}
                >
                  <option value={0}>{t('All members')}</option>
                  {props.members.map((m) => (
                    <option value={m.user_id} key={m.user_id}>
                      {m.display_name || m.username} (member-{m.user_id})
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={!props.range || busy}
                onClick={() => {
                  if (props.range) {
                    preview.mutate({ ...props.range, member_id: memberID })
                  }
                }}
              >
                {t('Prepare data preview')}
              </Button>
            </div>
          )}
          {run && (
            <>
              <p className='text-muted-foreground text-xs'>
                {t('Analysis period')}: {formatTimestamp(run.start_time)} /{' '}
                {formatTimestamp(run.end_time)}
              </p>
              <details className='min-w-0 border-y py-3'>
                <summary className='cursor-pointer text-sm'>
                  {t('Data to share')}
                </summary>
                <pre className='mt-3 max-h-64 overflow-auto text-xs break-all whitespace-pre-wrap'>
                  {run.snapshot
                    ? JSON.stringify(JSON.parse(run.snapshot), null, 2)
                    : ''}
                </pre>
              </details>
            </>
          )}
          <div
            role='log'
            aria-label={t('Analysis conversation')}
            aria-live='polite'
            className='min-h-40 min-w-0 space-y-5'
          >
            {messages.map((message, index) => (
              // Append-only messages have stable positions within an immutable transcript.
              // oxlint-disable-next-line react/no-array-index-key
              <article key={index} className='min-w-0 border-b pb-4'>
                <h3 className='mb-2 text-xs font-semibold'>
                  {message.role === 'user'
                    ? t('Administrator')
                    : t('AI assistant')}
                </h3>
                <p className='text-sm leading-6 [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
                  {message.content}
                </p>
              </article>
            ))}
            {busy && (
              <p role='status' className='flex items-center gap-2 text-sm'>
                <Loader2 className='size-4 animate-spin' />
                {t(chat.isPending ? 'Analyzing...' : 'Loading...')}
              </p>
            )}
          </div>
          {error && (
            <p role='alert' className='text-destructive text-sm'>
              {t(error)}
            </p>
          )}
          {messages.length >= 12 && (
            <p role='status'>{t('member_usage_ai_conversation_limit')}</p>
          )}
          <form
            className='space-y-3'
            onSubmit={(e) => {
              e.preventDefault()
              if (canSend && run && config.data) {
                chat.mutate({
                  parent_id: run.id,
                  question: question.trim(),
                  consent,
                  config_version: config.data.version,
                })
              }
            }}
          >
            <Label htmlFor='analysis-question'>{t('Question for AI')}</Label>
            <Textarea
              id='analysis-question'
              value={question}
              maxLength={2000}
              disabled={busy}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
            />
            <label className='flex items-start gap-2 text-xs leading-5'>
              <input
                type='checkbox'
                className='mt-1 shrink-0'
                checked={consent && consentVersion === config.data?.version}
                disabled={!run || busy}
                onChange={(e) => {
                  setConsent(e.target.checked)
                  setConsentVersion(config.data?.version ?? null)
                }}
              />
              <span className='break-all'>
                {t('analysis_external_consent')} {config.data?.base_url}
              </span>
            </label>
            <div className='flex justify-end'>
              <Button type='submit' disabled={!canSend}>
                <Send />
                {t('Send analysis question')}
              </Button>
            </div>
          </form>
        </div>
      </div>
      {settings && config.data && (
        <AnalysisSettings
          config={config.data}
          onClose={() => setSettings(false)}
          onSaved={(value) => {
            client.setQueryData(['analysis-config'], value)
            setConsent(false)
            test.reset()
          }}
        />
      )}
    </section>
  )
}
