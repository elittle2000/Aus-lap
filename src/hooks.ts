import { useMemo } from 'react'
import { useStore } from './store'
import { staySpans, totalDays } from './domain/stays'
import { daysBetween, todayIn } from './lib/dates'

/** Trip-wide derived values: dates for every stay, today, and where we are in the trip. */
export function useTrip() {
  const stays = useStore((s) => s.stays)
  const departure = useStore((s) => s.settings.departureDate)
  return useMemo(() => {
    const today = todayIn()
    const spans = staySpans(stays, departure)
    const length = totalDays(stays)
    const dayNumber = daysBetween(departure, today) + 1 // 1 on departure day
    return {
      today,
      departure,
      spans,
      length,
      daysToGo: daysBetween(today, departure),
      dayNumber,
      phase: dayNumber < 1 ? ('before' as const) : dayNumber > length ? ('after' as const) : ('during' as const),
    }
  }, [stays, departure])
}
