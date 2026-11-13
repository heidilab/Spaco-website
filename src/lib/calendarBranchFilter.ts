/**
 * Branch filter of the admin 總日曆 — PURE, tested.
 *
 * The filter used to list every room of 尖沙咀 HART (Room A / Room B /
 * Room A+B) as its own entry while 上環 was hand-coded into one 「上環店」
 * (Heidi 2026-06). Heidi 2026-11-13: HART must read the same way. So the
 * filter now lists one entry per BRANCH (lib/branchGrouping — the same
 * grouping as the public site), and a multi-room branch's entry shows the
 * bookings, blocks and Google Calendar rows of all its rooms together,
 * since they share one physical space.
 *
 * A multi-room branch is the option value `group:<branchKey>`; a
 * single-space branch is its venue id, as before.
 */
import type { Venue } from '@/types';
import { groupBranches } from './branchGrouping';
import { isCombinedRoom, orderRooms } from './roomOrder';

export const GROUP_PREFIX = 'group:';

export interface CalendarFilterOption {
  /** Option value: a venue id, or `group:<branchKey>`. */
  value: string;
  name: { zh: string; en: string };
  /** Venue ids the option covers (one for a single-space branch). */
  venueIds: string[];
  /** The room a new manual block defaults to: the whole-floor option when
   *  there is one (blocking the whole space is the common case), else the
   *  first room. */
  defaultVenueId: string;
}

/** The filter's entries, in the site's branch order (全部分店 is added by the page). */
export function calendarFilterOptions(venues: Venue[]): CalendarFilterOption[] {
  return groupBranches(venues).map((b) => {
    const rooms = orderRooms(b.rooms);
    const combined = rooms.find(isCombinedRoom);
    const multi = rooms.length > 1;
    return {
      value: multi ? `${GROUP_PREFIX}${b.key}` : rooms[0].id,
      name: multi ? b.name : rooms[0].name,
      venueIds: rooms.map((r) => r.id),
      defaultVenueId: (combined || rooms[0]).id,
    };
  });
}

export function isGroupFilter(value: string): boolean {
  return value.startsWith(GROUP_PREFIX);
}

/** The option a filter value stands for, or null for 'all' / unknown. */
export function filterOption(options: CalendarFilterOption[], value: string): CalendarFilterOption | null {
  return options.find((o) => o.value === value) || null;
}

/** Venue ids a filter value covers: [] for 全部分店. */
export function filterVenueIds(options: CalendarFilterOption[], value: string): string[] {
  if (value === 'all') return [];
  const opt = filterOption(options, value);
  return opt ? opt.venueIds : [value];
}

/** Among the rows a Google Calendar event is mirrored onto (one per room
 *  of a shared space), the one to show: the whole-floor room's, so the
 *  label says the whole branch was taken. */
export function preferredGcalRow<T extends { venueId: string }>(rows: T[], venues: Venue[]): T {
  const byId = new Map(venues.map((v) => [v.id, v]));
  return rows.find((r) => { const v = byId.get(r.venueId); return !!v && isCombinedRoom(v); }) || rows[0];
}
