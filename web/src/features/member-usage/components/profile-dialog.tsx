import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { handleServerError } from '@/lib/handle-server-error'

import { saveUsageProfile } from '../api'
import type { UsageMember } from '../types'

const profileSchema = z.object({
  member_type: z.enum(['unspecified', 'intern', 'full_time', 'other']),
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
    },
  })
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof profileSchema>) =>
      saveUsageProfile({ user_id: props.member.user_id, ...values }),
    onSuccess: () => {
      toast.success(t('Member type saved'))
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
      title={t('Edit member type')}
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
            <option value='other'>{t('usage_type_other')}</option>
          </select>
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
