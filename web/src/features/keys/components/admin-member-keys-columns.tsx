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
import { useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'

import { USER_STATUSES } from '../../users/constants'
import { API_KEY_STATUSES } from '../constants'
import type { ManagedMemberKey } from '../types'
import { AdminMemberKeyCell } from './admin-member-key-cell'

export function useAdminMemberKeysColumns(): ColumnDef<ManagedMemberKey>[] {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return [
    {
      id: 'member',
      accessorKey: 'username',
      header: t('Member'),
      cell: ({ row }) => (
        <div className='min-w-[170px]'>
          <div className='font-medium'>
            {row.original.display_name || row.original.username}
          </div>
          <div className='text-muted-foreground text-xs'>
            @{row.original.username}
          </div>
          {row.original.email && (
            <div className='text-muted-foreground max-w-[220px] truncate text-xs'>
              {row.original.email}
            </div>
          )}
        </div>
      ),
      size: 220,
      meta: { mobileTitle: true },
    },
    {
      accessorKey: 'user_status',
      header: t('Account status'),
      cell: ({ row }) => {
        const userStatus = row.original
          .user_status as keyof typeof USER_STATUSES
        const config = USER_STATUSES[userStatus]
        if (!config) return null
        return (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            copyable={false}
          />
        )
      },
      size: 120,
    },
    {
      id: 'key',
      accessorKey: 'key',
      header: t('API Key'),
      cell: ({ row }) => (
        <div className='space-y-1'>
          <div className='max-w-[280px] truncate text-xs font-medium'>
            {row.original.name}
          </div>
          <AdminMemberKeyCell apiKey={row.original} />
        </div>
      ),
      size: 310,
    },
    {
      accessorKey: 'status',
      header: t('Key status'),
      cell: ({ row }) => {
        const config = API_KEY_STATUSES[row.original.status]
        if (!config) return null
        return (
          <StatusBadge
            label={t(config.label)}
            variant={config.variant}
            copyable={false}
          />
        )
      },
      filterFn: (row, id, value) => value.includes(String(row.getValue(id))),
      size: 110,
      meta: { mobileBadge: true },
    },
    {
      id: 'usage',
      accessorKey: 'user_used_quota',
      header: t('Account internal units'),
      cell: ({ row }) => (
        <div className='min-w-[135px] space-y-0.5'>
          <div className='font-medium tabular-nums'>
            {row.original.user_used_quota.toLocaleString()}
          </div>
          <div className='text-muted-foreground text-xs'>
            {t('Key internal units')}: {row.original.used_quota.toLocaleString()}
          </div>
        </div>
      ),
      size: 155,
    },
    {
      accessorKey: 'user_request_count',
      header: t('Member requests'),
      cell: ({ row }) => (
        <span className='font-medium tabular-nums'>
          {row.original.user_request_count.toLocaleString()}
        </span>
      ),
      size: 110,
    },
    {
      accessorKey: 'accessed_time',
      header: t('Last Used'),
      cell: ({ row }) => (
        <span className='text-muted-foreground whitespace-nowrap'>
          {row.original.accessed_time > 0
            ? formatTimestamp(row.original.accessed_time)
            : t('Never used')}
        </span>
      ),
      size: 180,
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => (
        <Button
          variant='ghost'
          size='sm'
          onClick={() =>
            void navigate({
              to: '/usage-logs/$section',
              params: { section: 'common' },
              search: { username: row.original.username },
            })
          }
        >
          <ScrollText />
          {t('View usage logs')}
        </Button>
      ),
      size: 145,
      meta: { pinned: 'right' as const },
    },
  ]
}
