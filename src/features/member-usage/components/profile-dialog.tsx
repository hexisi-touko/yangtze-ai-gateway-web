import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { saveUsageProfile } from '../api'
import type { UsageMember } from '../types'

const profileSchema = z.object({
  member_type: z.enum(['unspecified', 'intern', 'full_time']),
  project: z.string().trim().max(120),
  purpose: z.string().trim().max(500),
})

export function ProfileDialog(props: {
  member: UsageMember
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      member_type: props.member.profile.member_type,
      project: props.member.profile.project,
      purpose: props.member.profile.purpose,
    },
  })
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof profileSchema>) =>
      saveUsageProfile({ ...props.member.profile, ...values }),
    onSuccess: () => {
      toast.success(t('Attribution saved'))
      void client.invalidateQueries({ queryKey: ['member-usage'] })
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
      title={t('Edit member attribution')}
      description={props.member.display_name || props.member.username}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <Button
          type='submit'
          form='usage-profile'
          disabled={mutation.isPending}
        >
          {t('Save')}
        </Button>
      }
    >
      <form
        id='usage-profile'
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className='space-y-2'>
          <Label htmlFor='member-type'>{t('Member type')}</Label>
          <select
            id='member-type'
            className='bg-background h-9 w-full rounded-md border px-3 text-sm'
            {...form.register('member_type')}
          >
            <option value='unspecified'>{t('usage_type_unspecified')}</option>
            <option value='intern'>{t('usage_type_intern')}</option>
            <option value='full_time'>{t('usage_type_full_time')}</option>
          </select>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='usage-project'>{t('Current project')}</Label>
          <Input
            id='usage-project'
            maxLength={120}
            {...form.register('project')}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='usage-purpose'>{t('Declared purpose')}</Label>
          <Textarea
            id='usage-purpose'
            maxLength={500}
            rows={4}
            {...form.register('purpose')}
          />
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert' className='text-destructive text-sm'>
            {t('member_usage_invalid_profile')}
          </p>
        )}
        {mutation.isError && (
          <p role='alert' className='text-destructive text-sm'>
            {t('Changes were not saved')}
          </p>
        )}
      </form>
    </Dialog>
  )
}
