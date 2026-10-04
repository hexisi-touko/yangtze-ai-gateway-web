import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { saveClientRelease, uploadClientReleaseFile } from '../api'
import type { ClientRelease, ClientReleaseInput } from '../types'

const releaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const releaseSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(releaseVersionPattern, '请输入三段式版本号，例如 1.1.1'),
  platform: z.enum(['windows-x64', 'windows-arm64']),
  channel: z.enum(['stable', 'beta']),
  release_notes: z.string().max(65536),
  download_url: z.string().trim().url(),
  file_name: z.string().trim().max(255),
  file_size: z.coerce.number().int().min(0),
  sha256: z
    .string()
    .trim()
    .refine((value) => value === '' || /^[a-fA-F0-9]{64}$/.test(value)),
  mandatory: z.boolean(),
})

type ReleaseFormInput = z.input<typeof releaseSchema>
type ReleaseFormValues = z.output<typeof releaseSchema>

const defaultValues: ReleaseFormValues = {
  version: '',
  platform: 'windows-x64',
  channel: 'stable',
  release_notes: '',
  download_url: '',
  file_name: '',
  file_size: 0,
  sha256: '',
  mandatory: false,
}

export function ReleaseEditorDialog(props: {
  release?: ClientRelease
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const form = useForm<ReleaseFormInput, unknown, ReleaseFormValues>({
    resolver: zodResolver(releaseSchema),
    defaultValues: props.release
      ? {
          version: props.release.version,
          platform: props.release.platform,
          channel: props.release.channel,
          release_notes: props.release.release_notes,
          download_url: props.release.download_url,
          file_name: props.release.file_name,
          file_size: props.release.file_size,
          sha256: props.release.sha256,
          mandatory: props.release.mandatory,
        }
      : defaultValues,
  })
  const mutation = useMutation({
    mutationFn: (values: ReleaseFormValues) =>
      saveClientRelease(values satisfies ClientReleaseInput, props.release?.id),
    onSuccess: () => {
      toast.success(t(props.release ? 'Draft updated' : 'Draft saved'))
      void client.invalidateQueries({ queryKey: ['client-releases'] })
      props.onClose()
    },
    onError: handleServerError,
  })
  const upload = useMutation({
    mutationFn: uploadClientReleaseFile,
    onMutate: () => setUploading(true),
    onSuccess: (file) => {
      form.setValue('download_url', file.download_url, { shouldValidate: true })
      form.setValue('file_name', file.file_name, { shouldValidate: true })
      form.setValue('file_size', file.file_size, { shouldValidate: true })
      form.setValue('sha256', file.sha256, { shouldValidate: true })
      toast.success(t('Installer uploaded'))
    },
    onError: handleServerError,
    onSettled: () => setUploading(false),
  })
  const errors = Object.keys(form.formState.errors).length > 0

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={t(props.release ? 'Edit client release' : 'New client release')}
      description={t('Choose an exe here to upload it to this New API server. The download URL will be filled in automatically.')}
      contentClassName='sm:max-w-2xl'
      bodyClassName='space-y-4'
      footer={
        <Button type='submit' form='client-release-editor' disabled={mutation.isPending}>
          {t(mutation.isPending ? 'Saving...' : 'Save draft')}
        </Button>
      }
    >
      <form
        id='client-release-editor'
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='client-release-version'>{t('Version')}</Label>
            <Input id='client-release-version' placeholder='例如 1.1.1' {...form.register('version')} />
            {form.formState.errors.version && (
              <p className='text-destructive text-xs' role='alert'>
                {t('请输入三段式版本号，例如 1.1.1')}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <Label>{t('Platform')}</Label>
            <Select
              value={form.watch('platform')}
              onValueChange={(value) => {
                if (value === 'windows-x64' || value === 'windows-arm64') {
                  form.setValue('platform', value)
                }
              }}
            >
              <SelectTrigger aria-label={t('Platform')} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='windows-x64'>Windows x64</SelectItem>
                <SelectItem value='windows-arm64'>Windows ARM64</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label>{t('Release channel')}</Label>
            <Select
              value={form.watch('channel')}
              onValueChange={(value) => {
                if (value === 'stable' || value === 'beta') {
                  form.setValue('channel', value)
                }
              }}
            >
              <SelectTrigger aria-label={t('Release channel')} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='stable'>{t('Stable')}</SelectItem>
                <SelectItem value='beta'>{t('Beta')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='client-release-file-name'>{t('Installer file name')}</Label>
            <Input id='client-release-file-name' maxLength={255} {...form.register('file_name')} />
          </div>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='client-release-file'>{t('Installer package (.exe)')}</Label>
          <Input
            id='client-release-file'
            type='file'
            accept='.exe,application/vnd.microsoft.portable-executable'
            disabled={uploading || mutation.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) upload.mutate(file)
              event.target.value = ''
            }}
          />
          <p className='text-muted-foreground text-xs'>
            {t('Choose an exe to upload it to this New API server. Existing files are not replaced.')}
          </p>
          {uploading && <p className='text-muted-foreground text-xs' role='status'>{t('Uploading installer...')}</p>}
        </div>
        <div className='space-y-2'>
          <Label htmlFor='client-release-download-url'>{t('Download URL')}</Label>
          <Input
            id='client-release-download-url'
            type='url'
            placeholder='https://.../client.exe'
            {...form.register('download_url')}
          />
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='client-release-size'>{t('File size (bytes)')}</Label>
            <Input id='client-release-size' type='number' min={0} {...form.register('file_size')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='client-release-sha256'>{t('SHA-256 checksum')}</Label>
            <Input id='client-release-sha256' maxLength={64} {...form.register('sha256')} />
          </div>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='client-release-notes'>{t('Release notes')}</Label>
          <Textarea id='client-release-notes' rows={6} maxLength={65536} {...form.register('release_notes')} />
        </div>
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={form.watch('mandatory')}
            onCheckedChange={(checked) => form.setValue('mandatory', checked === true)}
          />
          {t('Require update')}
        </label>
        {errors && <p role='alert' className='text-destructive text-sm'>{t('Check the release fields and try again.')}</p>}
        {mutation.isError && <p role='alert' className='text-destructive text-sm'>{t('Client release could not be saved.')}</p>}
      </form>
    </Dialog>
  )
}
