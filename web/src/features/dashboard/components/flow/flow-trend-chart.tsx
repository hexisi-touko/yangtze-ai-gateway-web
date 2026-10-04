import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import { Activity, Coins, Hash, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getMemberUsageTrend,
  getUserQuotaDates,
} from '@/features/dashboard/api'
import { buildQueryParams, getDefaultDays } from '@/features/dashboard/lib'
import type {
  DashboardFilters,
  MemberUsageTrendPoint,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { formatPercent, formatQuota, formatTokens } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { computeTimeRange, formatChartTime } from '@/lib/time'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'
import { useAuthStore } from '@/stores/auth-store'

interface FlowTrendChartProps {
  filters?: DashboardFilters
}

type TrendPoint = {
  Time: string
  Value: number
  RawValue: number
  Metric: string
  Unit: 'tokens' | 'percent'
}

type TrendSeries = {
  id: string
  name: string
  color: string
  axis: 'tokens' | 'rate'
  values: TrendPoint[]
}

type TrendQueryData =
  | { kind: 'member'; points: MemberUsageTrendPoint[] }
  | { kind: 'quota'; points: QuotaDataItem[] }

type UsageBucket = {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  cacheEligibleInput: number
  requests: number
  quota: number
  legacyTokens: number
}

export function FlowTrendChart({ filters }: FlowTrendChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const role = useAuthStore((state) => state.auth.user?.role)
  const isAdmin = Boolean(role && role >= ROLE.ADMIN)
  const range = useMemo(
    () =>
      computeTimeRange(
        getDefaultDays(filters?.time_granularity),
        filters?.start_timestamp,
        filters?.end_timestamp
      ),
    [
      filters?.end_timestamp,
      filters?.start_timestamp,
      filters?.time_granularity,
    ]
  )
  const params = useMemo(
    () => buildQueryParams(range, filters),
    [filters, range]
  )
  const query = useQuery({
    queryKey: ['dashboard', 'flow-trend', params, isAdmin],
    queryFn: async (): Promise<TrendQueryData> => {
      if (isAdmin) {
        return {
          kind: 'member',
          points: await getMemberUsageTrend({
            start: params.start_timestamp,
            end: params.end_timestamp,
            granularity: params.default_time,
          }),
        }
      }
      const response = await getUserQuotaDates(params, false)
      return {
        kind: 'quota',
        points: response.success ? response.data : [],
      }
    },
    staleTime: 60_000,
    refetchInterval: 30_000,
  })
  const granularity = filters?.time_granularity || 'day'
  const trend = useMemo(() => {
    const buckets = new Map<string, UsageBucket>()
    const emptyBucket = (): UsageBucket => ({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheEligibleInput: 0,
      requests: 0,
      quota: 0,
      legacyTokens: 0,
    })
    const addBucket = (time: string): UsageBucket => {
      const current = buckets.get(time)
      if (current) return current
      const created = emptyBucket()
      buckets.set(time, created)
      return created
    }
    const finite = (value: number | undefined): number => {
      const numberValue = Number(value)
      return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0
    }

    if (query.data?.kind === 'member') {
      for (const row of query.data.points) {
        const time = formatChartTime(Number(row.created_at) || 0, granularity)
        const current = addBucket(time)
        current.inputTokens += finite(row.input_tokens)
        current.outputTokens += finite(row.output_tokens)
        current.cacheCreationTokens += finite(row.cache_creation_tokens)
        current.cacheReadTokens += finite(row.cache_read_tokens)
        current.cacheEligibleInput += finite(row.cache_eligible_input)
        current.requests += finite(row.requests)
        current.quota += finite(row.quota)
      }
    } else if (query.data?.kind === 'quota') {
      for (const row of query.data.points) {
        const time = formatChartTime(Number(row.created_at) || 0, granularity)
        const current = addBucket(time)
        current.legacyTokens += finite(row.token_used)
        current.requests += finite(row.count)
        current.quota += finite(row.quota)
      }
    }

    const sortedBuckets = [...buckets.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )
    const createSeries = (
      id: string,
      name: string,
      color: string,
      axis: TrendSeries['axis'],
      unit: TrendPoint['Unit'],
      getValue: (bucket: UsageBucket) => number
    ): TrendSeries => ({
      id,
      name,
      color,
      axis,
      values: sortedBuckets.map(([time, bucket]) => {
        const rawValue = getValue(bucket)
        return {
          Time: time,
          Value: rawValue,
          RawValue: rawValue,
          Metric: name,
          Unit: unit,
        }
      }),
    })

    const isMemberTrend = query.data?.kind === 'member'
    const series: TrendSeries[] = isMemberTrend
      ? [
          createSeries(
            'input-tokens',
            t('Input tokens'),
            '#2563eb',
            'tokens',
            'tokens',
            (bucket) => bucket.inputTokens
          ),
          createSeries(
            'output-tokens',
            t('Output tokens'),
            '#16a34a',
            'tokens',
            'tokens',
            (bucket) => bucket.outputTokens
          ),
          createSeries(
            'cache-write-tokens',
            t('Cache write tokens'),
            '#f59e0b',
            'tokens',
            'tokens',
            (bucket) => bucket.cacheCreationTokens
          ),
          createSeries(
            'cache-read-tokens',
            t('Cache read tokens'),
            '#8b5cf6',
            'tokens',
            'tokens',
            (bucket) => bucket.cacheReadTokens
          ),
          createSeries(
            'cache-hit-rate',
            t('Cache hit rate'),
            '#dc2626',
            'rate',
            'percent',
            (bucket) =>
              bucket.cacheEligibleInput > 0
                ? Math.min(
                    100,
                    (bucket.cacheReadTokens / bucket.cacheEligibleInput) * 100
                  )
                : 0
          ),
        ]
      : [
          createSeries(
            'tokens',
            t('Tokens'),
            '#2563eb',
            'tokens',
            'tokens',
            (bucket) => bucket.legacyTokens
          ),
          createSeries(
            'requests',
            t('Requests'),
            '#16a34a',
            'tokens',
            'tokens',
            (bucket) => bucket.requests
          ),
        ]

    const totalInput = [...buckets.values()].reduce(
      (sum, item) => sum + item.inputTokens,
      0
    )
    const totalOutput = [...buckets.values()].reduce(
      (sum, item) => sum + item.outputTokens,
      0
    )
    const totalLegacyTokens = [...buckets.values()].reduce(
      (sum, item) => sum + item.legacyTokens,
      0
    )
    const totalRequests = [...buckets.values()].reduce(
      (sum, item) => sum + item.requests,
      0
    )
    const totalCacheEligible = [...buckets.values()].reduce(
      (sum, item) => sum + item.cacheEligibleInput,
      0
    )
    const totalCacheRead = [...buckets.values()].reduce(
      (sum, item) => sum + item.cacheReadTokens,
      0
    )
    return {
      series,
      tokenSeriesIds: series
        .filter((item) => item.axis === 'tokens')
        .map((item) => item.id),
      hasRateSeries: isMemberTrend,
      totalTokens: isMemberTrend ? totalInput + totalOutput : totalLegacyTokens,
      totalRequests,
      totalQuota: [...buckets.values()].reduce(
        (sum, item) => sum + item.quota,
        0
      ),
      cacheHitRate:
        totalCacheEligible > 0 ? totalCacheRead / totalCacheEligible : null,
    }
  }, [granularity, query.data, t])
  const spec = useMemo(
    () => ({
      type: 'common' as const,
      series: trend.series.map((metric) => ({
        type: 'line' as const,
        id: metric.id,
        name: metric.name,
        data: { id: metric.id, values: metric.values },
        xField: 'Time',
        yField: 'Value',
        line: { style: { lineWidth: 2, stroke: metric.color } },
        // A single time bucket cannot draw a line, so keep its data point visible.
        point: { visible: metric.values.length === 1 },
      })),
      axes: [
        {
          id: 'flow-time-axis',
          orient: 'bottom' as const,
          type: 'band' as const,
          label: { autoLimit: true },
          tick: { visible: false },
        },
        {
          id: 'flow-token-axis',
          orient: 'left' as const,
          type: 'linear' as const,
          seriesId: trend.tokenSeriesIds,
          label: {
            formatMethod: (value: number | string) =>
              formatTokens(Number(value) || 0),
          },
        },
        ...(trend.hasRateSeries
          ? [
              {
                id: 'flow-rate-axis',
                orient: 'right' as const,
                type: 'linear' as const,
                seriesId: ['cache-hit-rate'],
                min: 0,
                max: 100,
                label: {
                  formatMethod: (value: number | string) =>
                    `${Number(value) || 0}%`,
                },
              },
            ]
          : []),
      ],
      legends: { visible: true, selectMode: 'multiple' },
      tooltip: {
        dimension: {
          content: [
            {
              key: (datum: TrendPoint) => datum.Metric,
              value: (datum: TrendPoint) =>
                datum.Unit === 'percent'
                  ? `${datum.RawValue.toFixed(1)}%`
                  : formatTokens(datum.RawValue),
            },
          ],
        },
      },
      animation: false,
      background: 'transparent',
    }),
    [trend]
  )
  let chart: ReactNode
  if (!themeReady || query.isLoading) {
    chart = <Skeleton className='h-full w-full' />
  } else if (trend.series.every((item) => item.values.length === 0)) {
    chart = (
      <Empty className='h-full border-0 py-12'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Activity />
          </EmptyMedia>
          <EmptyTitle>{t('No data available')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'No usage logs available. Logs will appear here once API calls are made.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    chart = (
      <VChart
        spec={{ ...spec, theme: resolvedTheme === 'dark' ? 'dark' : 'light' }}
        option={VCHART_OPTION}
      />
    )
  }

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-center gap-3 border-b px-3 py-3 sm:px-5'>
        <IconBadge tone='info' size='sm'>
          <Activity />
        </IconBadge>
        <div className='text-sm font-semibold'>{t('Flow')}</div>
        <div className='ml-auto flex flex-wrap items-center gap-3 text-xs'>
          <Button
            aria-label={t('Refresh')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            size='icon-xs'
            title={t('Refresh')}
            variant='ghost'
          >
            <RefreshCw
              className={query.isFetching ? 'animate-spin' : undefined}
            />
          </Button>
          <span className='inline-flex items-center gap-1.5'>
            <Hash className='size-3.5 text-blue-600' />
            {t('Tokens')}: {trend.totalTokens.toLocaleString()}
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <Activity className='size-3.5 text-green-600' />
            {t('Requests')}: {trend.totalRequests.toLocaleString()}
          </span>
          {trend.hasRateSeries && (
            <span className='inline-flex items-center gap-1.5'>
              <Activity className='size-3.5 text-red-600' />
              {t('Cache hit rate')}:{' '}
              {trend.cacheHitRate == null
                ? '-'
                : formatPercent(trend.cacheHitRate * 100)}
            </span>
          )}
          <span className='inline-flex items-center gap-1.5'>
            <Coins className='size-3.5 text-amber-600' />
            {t('Cost')}: {formatQuota(trend.totalQuota)}
          </span>
          {query.isFetching && (
            <Loader2 className='text-muted-foreground size-3.5 animate-spin' />
          )}
        </div>
      </div>
      <div className='h-[420px] p-3 sm:h-[520px] sm:p-5'>{chart}</div>
    </div>
  )
}
