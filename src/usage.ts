export interface UsageEvent {
  clientId: string;
  route: string;
  provider?: string;
  timestamp: string;
  cacheHit?: boolean;
}

const events: UsageEvent[] = [];
const MAX_MEMORY_EVENTS = 10_000;

export function recordUsage(event: UsageEvent) {
  events.push(event);
  if (events.length > MAX_MEMORY_EVENTS) events.splice(0, events.length - MAX_MEMORY_EVENTS);
}

export function usageSummary(clientId: string) {
  const mine = events.filter(e => e.clientId === clientId);
  return {
    clientId,
    requests: mine.length,
    byProvider: mine.reduce<Record<string, number>>((acc, e) => {
      if (e.provider) acc[e.provider] = (acc[e.provider] ?? 0) + 1;
      return acc;
    }, {})
  };
}
