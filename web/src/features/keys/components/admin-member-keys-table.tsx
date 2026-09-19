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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getManagedMemberKeys } from '../api'
import { API_KEY_STATUS_OPTIONS } from '../constants'
import { useAdminMemberKeysColumns } from './admin-member-keys-columns'

const route = getRouteApi('/_authenticated/keys/')

export function AdminMemberKeysTable() {
  const { t } = useTranslation()
  const columns = useAdminMemberKeysColumns()
  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const selectedStatus = columnFilters.find(
    (filter) => filter.id === 'status'
  )?.value
  const status = Array.isArray(selectedStatus)
    ? String(selectedStatus[0] ?? '')
    : ''

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      'admin-member-keys',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      status,
    ],
    queryFn: async () => {
      const result = await getManagedMemberKeys({
        keyword: globalFilter,
        status,
        p: pagination.pageIndex + 1,
        size: pagination.pageSize,
      })
      if (!result.success) {
        throw new Error(result.message || 'Failed to load member API keys')
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
    retry: false,
  })

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    enableRowSelection: false,
    columnFilters,
    globalFilter,
    pagination,
    globalFilterFn: () => true,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
    columnVisibilityStorageKey: 'admin-member-keys:column-visibility',
  })

  if (isError) {
    return (
      <div
        role='alert'
        className='flex flex-wrap items-center gap-3 border-y py-6'
      >
        <p className='text-destructive text-sm'>
          {t('Failed to load member API keys')}
        </p>
        <Button
          variant='outline'
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className={isFetching ? 'animate-spin' : ''} />
          {t('Retry')}
        </Button>
      </div>
    )
  }

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No member keys found')}
      emptyDescription={t(
        'No approved member API keys match the current filters.'
      )}
      skeletonKeyPrefix='admin-member-keys-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Search by username, name, email, or key name...'),
        searchDebounceMs: 500,
        filters: [
          {
            columnId: 'status',
            title: t('Key status'),
            options: API_KEY_STATUS_OPTIONS.map((option) => ({
              ...option,
              label: t(option.label),
            })),
            singleSelect: true,
          },
        ],
      }}
      mobileProps={{
        getRowKey: (row) => row.original.id,
      }}
    />
  )
}
