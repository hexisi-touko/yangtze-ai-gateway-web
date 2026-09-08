import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import { saveAnalysisConfig, type AnalysisConfig } from '../ai-api'

const schema = z.object({
  base_url: z.url().startsWith('https://').max(500),
  model: z.string().trim().min(1).max(120),
  api_key: z.string().max(4096),
})

export function AnalysisSettings(props: {
  config: AnalysisConfig
  onClose: () => void
  onSaved: (config: AnalysisConfig) => void
}) {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      base_url: props.config.base_url,
      model: props.config.model,
      api_key: '',
    },
  })
  const mutation = useMutation({
    mutationFn: saveAnalysisConfig,
    onSuccess: (config) => {
      form.reset()
      props.onSaved(config)
      props.onClose()
    },
  })
  return (
    <Dialog
      open
      title={t('Analysis service')}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      footer={
        <Button
          type='submit'
          form='analysis-settings'
          disabled={mutation.isPending}
        >
          {t('Save')}
        </Button>
      }
      bodyClassName='space-y-4'
    >
      <form
        id='analysis-settings'
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <p className='text-muted-foreground text-sm'>
          {t('OpenAI-compatible Chat Completions')}
        </p>
        <div className='space-y-2'>
          <Label htmlFor='analysis-url'>{t('API base URL')}</Label>
          <Input
            id='analysis-url'
            placeholder='https://api.example.com/v1'
            {...form.register('base_url')}
            aria-invalid={!!form.formState.errors.base_url}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='analysis-model'>{t('Model ID')}</Label>
          <Input
            id='analysis-model'
            {...form.register('model')}
            aria-invalid={!!form.formState.errors.model}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='analysis-key'>{t('Analysis API key')}</Label>
          <Input
            id='analysis-key'
            type='password'
            autoComplete='new-password'
            {...form.register('api_key')}
            placeholder={
              props.config.has_key ? t('Leave blank to keep the saved key') : ''
            }
          />
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert'>{t('member_usage_ai_invalid_config')}</p>
        )}
        {mutation.isError && (
          <p role='alert' className='text-destructive'>
            {t(
              getServerErrorMessageKey(mutation.error) ||
                'member_usage_ai_upstream_error'
            )}
          </p>
        )}
      </form>
      {props.config.has_key && (
        <Button
          variant='outline'
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              base_url: props.config.base_url,
              model: props.config.model,
              api_key: '',
              clear_key: true,
            })
          }
        >
          {t('Disconnect analysis service')}
        </Button>
      )}
    </Dialog>
  )
}
