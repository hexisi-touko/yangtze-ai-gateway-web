import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatTimestamp } from '@/lib/format'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import {
  deleteClientRelease,
  getClientReleases,
  setClientReleasePublished,
} from './api'
import { ReleaseEditorDialog } from './components/release-editor-dialog'
import type { ClientRelease } from './types'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`
}

export function ClientReleases() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [editing, setEditing] = useState<ClientRelease | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleting, setDeleting] = useState<ClientRelease | null>(null)
  const releases = useQuery({
    queryKey: ['client-releases'],
    queryFn: getClientReleases,
    retry: false,
  })
  const publish = useMutation({
    mutationFn: (input: { release: ClientRelease; published: boolean }) =>
      setClientReleasePublished(input.release.id, input.published),
    onSuccess: (release, input) => {
      toast.success(t(input.published ? 'Release published' : 'Release unpublished'))
      client.setQueryData<ClientRelease[]>(['client-releases'], (current) =>
        current?.map((item) => (item.id === release.id ? release : item))
      )
    },
    onError: (error) => toast.error(t(getServerErrorMessageKey(error) || 'Client releases could not be updated.')),
  })
  const remove = useMutation({
    mutationFn: deleteClientRelease,
    onSuccess: () => {
      toast.success(t('Draft deleted'))
      void client.invalidateQueries({ queryKey: ['client-releases'] })
      setDeleting(null)
    },
    onError: (error) => toast.error(t(getServerErrorMessageKey(error) || 'Client release could not be deleted.')),
  })
  const openEditor = (release: ClientRelease | null) => {
    setEditing(release)
    setEditorOpen(true)
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Client releases')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            size='icon'
            aria-label={t('Refresh')}
            disabled={releases.isFetching}
            onClick={() => void releases.refetch()}
          >
            <RefreshCw className={releases.isFetching ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => openEditor(null)}>
            <Plus />
            {t('New client release')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='mx-auto w-full max-w-[1440px] space-y-4'>
            <p className='text-muted-foreground text-sm'>
              {t('Upload an exe in the release form. The server stores the file and publishes its download URL with the version.')}
            </p>
            {releases.isPending && (
              <div className='text-muted-foreground rounded-lg border py-12 text-center text-sm' role='status'>
                {t('Loading client releases...')}
              </div>
            )}
            {releases.isError && (
              <p className='text-destructive rounded-lg border px-4 py-6 text-sm' role='alert'>
                {t(getServerErrorMessageKey(releases.error) || 'Client releases could not be loaded.')}
              </p>
            )}
            {releases.data && releases.data.length === 0 && (
              <div className='text-muted-foreground rounded-lg border py-12 text-center text-sm'>
                {t('No client releases yet')}
              </div>
            )}
            {releases.data && releases.data.length > 0 && (
              <div className='overflow-x-auto rounded-lg border'>
                <table className='w-full min-w-[920px] text-left text-sm'>
                  <thead className='bg-muted/50 text-muted-foreground'>
                    <tr>
                      <th className='px-4 py-3 font-medium'>{t('Version')}</th>
                      <th className='px-4 py-3 font-medium'>{t('Platform')}</th>
                      <th className='px-4 py-3 font-medium'>{t('Release channel')}</th>
                      <th className='px-4 py-3 font-medium'>{t('Release status')}</th>
                      <th className='px-4 py-3 font-medium'>{t('Package')}</th>
                      <th className='px-4 py-3 font-medium'>{t('Updated')}</th>
                      <th className='px-4 py-3 text-right font-medium'>{t('Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {releases.data.map((release) => (
                      <tr key={release.id} className='align-top'>
                        <td className='px-4 py-3'>
                          <div className='font-medium'>v{release.version}</div>
                          {release.mandatory && (
                            <span className='text-muted-foreground text-xs'>{t('Required update')}</span>
                          )}
                          {release.release_notes && (
                            <p className='text-muted-foreground mt-1 max-w-64 truncate text-xs' title={release.release_notes}>
                              {release.release_notes}
                            </p>
                          )}
                        </td>
                        <td className='px-4 py-3'>{release.platform === 'windows-arm64' ? 'Windows ARM64' : 'Windows x64'}</td>
                        <td className='px-4 py-3'>{t(release.channel === 'beta' ? 'Beta' : 'Stable')}</td>
                        <td className='px-4 py-3'>
                          <span className={release.published ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>
                            {t(release.published ? 'Published' : 'Draft')}
                          </span>
                        </td>
                        <td className='px-4 py-3'>
                          <div className='flex items-center gap-1.5'>
                            <a
                              className='text-primary inline-flex max-w-56 items-center gap-1 truncate hover:underline'
                              href={release.download_url}
                              target='_blank'
                              rel='noreferrer'
                              title={release.download_url}
                            >
                              <Download className='size-3.5 shrink-0' />
                              <span className='truncate'>{release.file_name || release.download_url}</span>
                            </a>
                          </div>
                          <span className='text-muted-foreground text-xs'>
                            {release.file_size > 0 ? formatFileSize(release.file_size) : t('Size not provided')}
                            {release.sha256 ? ` · SHA-256 ${release.sha256.slice(0, 10)}…` : ''}
                          </span>
                        </td>
                        <td className='text-muted-foreground px-4 py-3 whitespace-nowrap'>
                          {formatTimestamp(release.updated_at)}
                        </td>
                        <td className='px-4 py-3'>
                          <div className='flex justify-end gap-2'>
                            {!release.published && (
                              <>
                                <Button size='sm' variant='outline' onClick={() => openEditor(release)}>
                                  {t('Edit')}
                                </Button>
                                <Button
                                  size='sm'
                                  disabled={publish.isPending}
                                  onClick={() => publish.mutate({ release, published: true })}
                                >
                                  {t('Publish')}
                                </Button>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  aria-label={t('Delete draft {{version}}', { version: release.version })}
                                  onClick={() => setDeleting(release)}
                                >
                                  <Trash2 />
                                </Button>
                              </>
                            )}
                            {release.published && (
                              <Button
                                size='sm'
                                variant='outline'
                                disabled={publish.isPending}
                                onClick={() => publish.mutate({ release, published: false })}
                              >
                                {t('Unpublish')}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {editorOpen && (
        <ReleaseEditorDialog
          release={editing ?? undefined}
          onClose={() => setEditorOpen(false)}
        />
      )}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete this draft?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('This removes the unpublished client release from the database.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={remove.isPending || deleting === null}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              <Trash2 />
              {t(remove.isPending ? 'Deleting...' : 'Delete draft')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
