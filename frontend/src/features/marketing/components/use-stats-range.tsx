import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '@/features/auth/use-auth'
import { MAX_RANGE_DAYS, STATS_PRESETS, statsRange } from '@/features/marketing/marketing'
import { DateRangeFilter } from '@/features/reports/components/date-range-filter'
import { rangeDays } from '@/features/reports/params'

/** The period in the address (`?from=&to=`), defaulting to the last 30 days. */
export function useStatsRange() {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const range = statsRange(searchParams, timeZone)
  const [tooLong, setTooLong] = useState(false)

  const filter = (
    <div className="flex flex-col gap-1">
      <DateRangeFilter
        key={`${range.from}|${range.to}`}
        idPrefix="marketing"
        from={range.from}
        to={range.to}
        timeZone={timeZone}
        presets={STATS_PRESETS}
        onChange={({ from, to }) => {
          const long = rangeDays(from, to) > MAX_RANGE_DAYS
          setTooLong(long)
          if (long) return
          const next = new URLSearchParams(searchParams)
          next.set('from', from)
          next.set('to', to)
          setSearchParams(next, { replace: true })
        }}
      />
      {tooLong && <p role="alert" className="text-sm text-destructive">Choose a period of at most one year.</p>}
    </div>
  )
  return { range, filter }
}
