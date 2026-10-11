import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

interface AdminVersion {
  version: string
  title: string
  status: string
  date: string
  tag: string
  summary: string
  changes: string[]
  technical: string[]
  limitations: string[]
}

interface UpdateManifest {
  current_version: string
  scope: string
  revision: string
  build_time: string
  versions: AdminVersion[]
}

export function AdminUpdates() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['admin-updates'],
    queryFn: async () => {
      const response = await api.get('/api/admin-updates')
      const result = response.data as { success: boolean; data: UpdateManifest }
      if (!result.success || !Array.isArray(result.data?.versions)) {
        throw new Error('admin_updates_unavailable')
      }
      return result.data
    },
    retry: false,
  })
  return (
    <main className='mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6'>
      <header className='flex flex-wrap items-start justify-between gap-4 border-b pb-5'>
        <div className='space-y-2'>
          <h1 className='flex items-center gap-2 text-xl font-semibold'>
            <History className='text-muted-foreground size-5' />
            {t('Admin update history')}
          </h1>
          <p className='text-muted-foreground max-w-2xl text-sm'>
            {t(
              'Business changes for teachers and future maintainers. Client releases are managed separately.'
            )}
          </p>
        </div>
        {query.data && (
          <div className='bg-muted/30 rounded-md border px-3 py-2 text-sm'>
            <span className='text-muted-foreground'>
              {t('Current admin version')}{' '}
            </span>
            <strong>{query.data.current_version}</strong>
          </div>
        )}
      </header>
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <div role='alert' className='space-y-3'>
          <p>
            {t(
              'Update history unavailable. Restart the updated local backend and try again.'
            )}
          </p>
          <Button variant='outline' onClick={() => void query.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      )}
      {query.data && (
        <>
          <p className='text-muted-foreground text-xs'>{query.data.scope}</p>
          <div className='divide-y border-y'>
            {query.data.versions.map((version) => (
              <details
                key={version.version}
                open={version.version === query.data.current_version}
                className='group py-5'
              >
                <summary className='flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 [&::-webkit-details-marker]:hidden'>
                  <div className='min-w-0 space-y-1'>
                    <h2 className='text-base font-semibold break-words'>
                      v{version.version} · {version.title}
                    </h2>
                    <p className='text-muted-foreground text-xs'>
                      {version.date} · {version.status}
                    </p>
                  </div>
                  <ChevronDown className='text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180' />
                </summary>
                <div className='mt-5 space-y-5'>
                  <p className='text-sm leading-6'>{version.summary}</p>
                  <section className='space-y-2'>
                    <h3 className='text-sm font-medium'>
                      {t('Business changes')}
                    </h3>
                    <ul className='list-disc space-y-2 pl-5 text-sm leading-6'>
                      {version.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </section>
                  <details className='rounded-md border px-3 py-3'>
                    <summary className='cursor-pointer text-sm font-medium'>
                      {t('Maintenance details')}
                    </summary>
                    <div className='mt-3 space-y-4 text-sm leading-6'>
                      <p className='text-muted-foreground'>
                        {t('Version tag')}: <code>{version.tag}</code>
                      </p>
                      <ul className='list-disc space-y-2 pl-5'>
                        {version.technical.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                      <h3 className='font-medium'>{t('Known limitations')}</h3>
                      <ul className='text-muted-foreground list-disc space-y-2 pl-5'>
                        {version.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </div>
              </details>
            ))}
          </div>
          <dl className='text-muted-foreground grid gap-2 text-xs sm:grid-cols-2'>
            <div>
              <dt>{t('Backend code revision')}</dt>
              <dd className='mt-1 break-all'>
                {query.data.revision === 'local-development'
                  ? t('Local development build')
                  : query.data.revision}
              </dd>
            </div>
            <div>
              <dt>{t('Build timestamp')}</dt>
              <dd className='mt-1'>
                {query.data.build_time === 'not-recorded'
                  ? t('Not recorded')
                  : query.data.build_time}
              </dd>
            </div>
          </dl>
        </>
      )}
    </main>
  )
}
