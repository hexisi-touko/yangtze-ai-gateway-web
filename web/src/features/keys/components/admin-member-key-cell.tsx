/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Check, Copy, Eye, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

import { fetchManagedMemberKey } from '../api'
import type { ManagedMemberKey } from '../types'

export function AdminMemberKeyCell(props: { apiKey: ManagedMemberKey }) {
  const { t } = useTranslation()
  const [fullKey, setFullKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const maskedKey = `sk-${props.apiKey.key}`

  const resolveKey = useCallback(async () => {
    if (fullKey) return fullKey
    setLoading(true)
    try {
      const result = await fetchManagedMemberKey(props.apiKey.id)
      if (!result.success || !result.data?.key) {
        toast.error(result.message || t('Failed to load API keys'))
        return ''
      }
      const resolved = result.data.key.startsWith('sk-')
        ? result.data.key
        : `sk-${result.data.key}`
      setFullKey(resolved)
      return resolved
    } catch {
      toast.error(t('Failed to load API keys'))
      return ''
    } finally {
      setLoading(false)
    }
  }, [fullKey, props.apiKey.id, t])

  const handleCopy = useCallback(async () => {
    const key = await resolveKey()
    if (!key || !(await copyToClipboard(key))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [resolveKey])

  return (
    <div className='flex min-w-[230px] items-center gap-1'>
      <code className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
        {maskedKey}
      </code>
      <Popover
        onOpenChange={(open) => {
          if (open) void resolveKey()
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('View full API key')}
                  />
                }
              />
            }
          >
            {loading ? <Loader2 className='animate-spin' /> : <Eye />}
          </TooltipTrigger>
          <TooltipContent>{t('View full API key')}</TooltipContent>
        </Tooltip>
        <PopoverContent className='w-[min(90vw,30rem)]' align='end'>
          <div className='space-y-2'>
            <p className='text-muted-foreground text-xs'>{t('Full API Key')}</p>
            <input
              readOnly
              value={loading ? t('Loading...') : fullKey || maskedKey}
              onFocus={(event) => event.target.select()}
              className='bg-muted/50 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none'
            />
          </div>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => void handleCopy()}
              disabled={loading}
              aria-label={t('Copy API key')}
            />
          }
        >
          {copied ? <Check className='text-success' /> : <Copy />}
        </TooltipTrigger>
        <TooltipContent>
          {copied ? t('Copied!') : t('Copy API key')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
