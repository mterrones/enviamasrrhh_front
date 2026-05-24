import { format } from "date-fns";
import type { VacationRequest } from "@/api/vacationRequests";
import { isWeekendIso } from "@/lib/weekendAttendance";

export type CalendarDayStatus = { day: number; status: string };

export function vacationOverlapsMonth(
  vacation: Pick<VacationRequest, "start_date" | "end_date">,
  monthStartIso: string,
  monthEndIso: string,
): boolean {
  return vacation.start_date <= monthEndIso && vacation.end_date >= monthStartIso;
}

export function monthDayCount(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function applyApprovedVacationsToStatusMap(
  statusByIso: Map<string, string>,
  vacations: Pick<VacationRequest, "start_date" | "end_date">[],
  monthStartIso: string,
  monthEndIso: string,
): void {
  vacations
    .filter((vacation) => vacationOverlapsMonth(vacation, monthStartIso, monthEndIso))
    .forEach((vacation) => {
      const fromDate = vacation.start_date < monthStartIso ? monthStartIso : vacation.start_date;
      const toDate = vacation.end_date > monthEndIso ? monthEndIso : vacation.end_date;
      let cursor = new Date(`${fromDate}T00:00:00`);
      const end = new Date(`${toDate}T00:00:00`);
      while (cursor <= end) {
        const iso = format(cursor, "yyyy-MM-dd");
        if (!isWeekendIso(iso)) {
          statusByIso.set(iso, "vacaciones");
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
    });
}

export function buildMonthCalendarDays(
  year: number,
  monthIndex: number,
  statusByIso: Map<string, string>,
): CalendarDayStatus[] {
  const total = monthDayCount(year, monthIndex);
  return Array.from({ length: total }, (_, i) => {
    const day = i + 1;
    const iso = format(new Date(year, monthIndex, day), "yyyy-MM-dd");
    const statusSt = statusByIso.get(iso) ?? "__none__";
    return { day, status: statusSt };
  });
}

export function buildStatusMapFromRecords(
  records: { record_date: string; status: string }[],
  recordDateToIso: (r: { record_date: string }) => string,
): Map<string, string> {
  const statusByIso = new Map<string, string>();
  records.forEach((r) => {
    statusByIso.set(recordDateToIso(r), r.status);
  });
  return statusByIso;
}

export function buildMonthCalendarDaysWithVacations(
  year: number,
  monthIndex: number,
  records: { record_date: string; status: string }[],
  approvedVacations: Pick<VacationRequest, "start_date" | "end_date">[],
  recordDateToIso: (r: { record_date: string }) => string,
): CalendarDayStatus[] {
  const monthStartIso = format(new Date(year, monthIndex, 1), "yyyy-MM-dd");
  const monthEndIso = format(new Date(year, monthIndex + 1, 0), "yyyy-MM-dd");
  const statusByIso = buildStatusMapFromRecords(records, recordDateToIso);
  applyApprovedVacationsToStatusMap(statusByIso, approvedVacations, monthStartIso, monthEndIso);
  return buildMonthCalendarDays(year, monthIndex, statusByIso);
}
