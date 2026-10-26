import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatTimestamp } from '@/lib/format'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import {
  deleteClientConfigRelease,
  getClientConfigReleases,
  saveClientConfigRelease,
  setClientConfigReleasePublished,
} from '../api'
import type { ClientConfigRelease, ClientConfigReleaseInput } from '../types'

const defaultDraft: ClientConfigReleaseInput = {
  version: 1,
  release_notes: '',
  config: { update_check_interval_minutes: 30, auto_check_updates: true },
  mandatory: false,
}

export function RemoteConfigPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ClientConfigRelease | null>(null)
  const [draft, setDraft] = useState<ClientConfigReleaseInput>(defaultDraft)
  const [open, setOpen] = useState(false)
  const query = useQuery({ queryKey: ['client-config-releases'], queryFn: getClientConfigReleases, retry: false })
  const save = useMutation({
    mutationFn: (input: ClientConfigReleaseInput) => saveClientConfigRelease(input, editing?.id),
    onSuccess: () => {
      toast.success(t(editing ? 'Configuration draft updated' : 'Configuration draft saved'))
      void queryClient.invalidateQueries({ queryKey: ['client-config-releases'] })
      setOpen(false)
    },
    onError: (error) => toast.error(t(getServerErrorMessageKey(error) || 'Client configuration could not be saved.')),
  })
  const publish = useMutation({
    mutationFn: (input: { id: number; published: boolean }) => setClientConfigReleasePublished(input.id, input.published),
    onSuccess: (_, input) => {
      toast.success(t(input.published ? 'Configuration published' : 'Configuration unpublished'))
      void queryClient.invalidateQueries({ queryKey: ['client-config-releases'] })
    },
    onError: (error) => toast.error(t(getServerErrorMessageKey(error) || 'Client configuration could not be updated.')),
  })
  const remove = useMutation({
    mutationFn: deleteClientConfigRelease,
    onSuccess: () => {
      toast.success(t('Configuration draft deleted'))
      void queryClient.invalidateQueries({ queryKey: ['client-config-releases'] })
    },
    onError: (error) => toast.error(t(getServerErrorMessageKey(error) || 'Configuration draft could not be deleted.')),
  })
  const openEditor = (release?: ClientConfigRelease) => {
    setEditing(release ?? null)
    setDraft(release ? {
      version: release.version,
      release_notes: release.release_notes,
      config: release.config,
      mandatory: release.mandatory,
    } : { ...defaultDraft, config: { ...defaultDraft.config } })
    setOpen(true)
  }
  const submit = () => {
    if (!Number.isInteger(draft.version) || draft.version <= 0) {
      toast.error(t('Configuration version must be a positive integer'))
      return
    }
    if (draft.config.update_check_interval_minutes < 5 || draft.config.update_check_interval_minutes > 1440) {
      toast.error(t('Check interval must be between 5 and 1440 minutes'))
      return
    }
    save.mutate(draft)
  }

  return (
    <section className='space-y-4 rounded-lg border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='flex items-center gap-2 text-base font-semibold'><Settings2 className='size-4' />{t('Remote client configuration')}</h2>
          <p className='text-muted-foreground max-w-2xl text-sm'>{t('Publish safe client settings without rebuilding the installer. Server address, HTTPS policy, and secrets cannot be changed here.')}</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' size='icon' aria-label={t('Refresh')} disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => openEditor()}><Plus />{t('New configuration version')}</Button>
        </div>
      </div>
      {query.isError && <p className='text-destructive text-sm' role='alert'>{t('Client configuration could not be loaded.')}</p>}
      {query.data && query.data.length === 0 && <p className='text-muted-foreground rounded-md border px-4 py-6 text-center text-sm'>{t('No configuration versions yet')}</p>}
      {query.data && query.data.length > 0 && (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full min-w-[760px] text-left text-sm'>
            <thead className='bg-muted/50 text-muted-foreground'><tr>
              <th className='px-3 py-2 font-medium'>{t('Config version')}</th>
              <th className='px-3 py-2 font-medium'>{t('Check interval')}</th>
              <th className='px-3 py-2 font-medium'>{t('Auto check')}</th>
              <th className='px-3 py-2 font-medium'>{t('Release status')}</th>
              <th className='px-3 py-2 font-medium'>{t('Updated')}</th>
              <th className='px-3 py-2 text-right font-medium'>{t('Actions')}</th>
            </tr></thead>
            <tbody className='divide-y'>{query.data.map((release) => <tr key={release.id}>
              <td className='px-3 py-2'><div className='font-medium'>v{release.version}</div><p className='text-muted-foreground max-w-64 truncate text-xs'>{release.release_notes}</p></td>
              <td className='px-3 py-2'>{release.config.update_check_interval_minutes} {t('minutes')}</td>
              <td className='px-3 py-2'>{t(release.config.auto_check_updates ? 'Enabled' : 'Disabled')}</td>
              <td className='px-3 py-2'>{t(release.published ? 'Published' : 'Draft')}</td>
              <td className='text-muted-foreground px-3 py-2 whitespace-nowrap'>{formatTimestamp(release.updated_at)}</td>
              <td className='px-3 py-2'><div className='flex justify-end gap-2'>
                {!release.published && <>
                  <Button size='sm' variant='outline' onClick={() => openEditor(release)}>{t('Edit')}</Button>
                  <Button size='sm' disabled={publish.isPending} onClick={() => publish.mutate({ id: release.id, published: true })}>{t('Publish')}</Button>
                  <Button size='icon' variant='ghost' aria-label={t('Delete configuration draft')} onClick={() => remove.mutate(release.id)}><Trash2 /></Button>
                </>}
                {release.published && <Button size='sm' variant='outline' disabled={publish.isPending} onClick={() => publish.mutate({ id: release.id, published: false })}>{t('Unpublish')}</Button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {open && <Dialog
        open
        onOpenChange={(value) => !value && !save.isPending && setOpen(false)}
        title={t(editing ? 'Edit configuration version' : 'New configuration version')}
        description={t('Only safe client behaviour settings are remotely configurable.')}
        contentClassName='sm:max-w-xl'
        footer={<Button type='button' disabled={save.isPending} onClick={submit}>{t(save.isPending ? 'Saving...' : 'Save draft')}</Button>}
      >
        <div className='space-y-4'>
          <div className='space-y-2'><Label htmlFor='client-config-version'>{t('Config version')}</Label><Input id='client-config-version' type='number' min={1} value={draft.version} onChange={(event) => setDraft({ ...draft, version: Number(event.target.value) })} /></div>
          <div className='space-y-2'><Label htmlFor='client-config-interval'>{t('Check interval (minutes)')}</Label><Input id='client-config-interval' type='number' min={5} max={1440} value={draft.config.update_check_interval_minutes} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, update_check_interval_minutes: Number(event.target.value) } })} /></div>
          <label className='flex items-center gap-2 text-sm'><Checkbox checked={draft.config.auto_check_updates} onCheckedChange={(checked) => setDraft({ ...draft, config: { ...draft.config, auto_check_updates: checked === true } })} />{t('Enable automatic update checks')}</label>
          <label className='flex items-center gap-2 text-sm'><Checkbox checked={draft.mandatory} onCheckedChange={(checked) => setDraft({ ...draft, mandatory: checked === true })} />{t('Mark configuration as important')}</label>
          <div className='space-y-2'><Label htmlFor='client-config-notes'>{t('Release notes')}</Label><Textarea id='client-config-notes' value={draft.release_notes} onChange={(event) => setDraft({ ...draft, release_notes: event.target.value })} maxLength={65536} /></div>
        </div>
      </Dialog>}
    </section>
  )
}
