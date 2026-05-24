import { Link } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Cake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDate } from "@/lib/formatAppDate";
import { useAuth } from "@/contexts/AuthContext";
import type { DashboardBirthdayCalendar, DashboardBirthdayEmployee, DashboardUpcomingBirthday } from "@/api/dashboardSummary";

const WEEK_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

function mondayFirstWeekdayIndex(date: Date): number {
  const sun0 = date.getDay();
  return sun0 === 0 ? 6 : sun0 - 1;
}

function buildDayMarkMap(markedDays: DashboardBirthdayCalendar["marked_days"]): Map<number, DashboardBirthdayEmployee[]> {
  const map = new Map<number, DashboardBirthdayEmployee[]>();
  for (const row of markedDays) {
    map.set(row.day, row.employees);
  }
  return map;
}

type DashboardBirthdaysSectionProps = {
  loading: boolean;
  calendar: DashboardBirthdayCalendar | null | undefined;
  upcoming: DashboardUpcomingBirthday[] | null | undefined;
  className?: string;
};

export function DashboardBirthdaysSection({ loading, calendar, upcoming, className }: DashboardBirthdaysSectionProps) {
  const { hasPermission } = useAuth();
  const canLinkEmployee = hasPermission("employees.view");

  if (loading) {
    return (
      <Card className={cn("shadow-card min-h-0 h-full flex flex-col", className)}>
        <CardHeader className="py-2.5 px-4 space-y-0">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Cake className="h-3.5 w-3.5 text-primary shrink-0" />
            Cumpleaños
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 flex-1 min-h-0">
          <p className="text-xs text-muted-foreground py-2">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (calendar == null || upcoming == null) {
    return null;
  }

  const { year, month, marked_days: markedDays } = calendar;
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadBlank = mondayFirstWeekdayIndex(first);
  const marks = buildDayMarkMap(markedDays);
  const now = new Date();
  const highlightToday =
    now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null;

  const monthTitle = format(first, "LLLL yyyy", { locale: es });
  const cells: (number | null)[] = [...Array(leadBlank).fill(null)];
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(d);
  }

  return (
    <Card className={cn("shadow-card min-h-0 h-full flex flex-col", className)}>
      <CardHeader className="py-2.5 px-4 space-y-0 shrink-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Cake className="h-3.5 w-3.5 text-primary shrink-0" />
            Cumpleaños
          </CardTitle>
          <p className="text-[11px] text-muted-foreground capitalize leading-none">{monthTitle}</p>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 sm:px-4 flex-1 min-h-0 flex flex-col">
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 min-h-0 flex-1">
            <div className="shrink-0 w-fit max-w-full">
              <div className="grid grid-cols-7 gap-px text-center text-[9px] font-medium text-muted-foreground mb-0.5">
                {WEEK_LABELS.map((l) => (
                  <div key={l} className="w-6">
                    {l}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {cells.map((day, idx) =>
                  day == null ? (
                    <div key={`b-${idx}`} className="h-6 w-6" />
                  ) : (
                    <DayCell
                      key={day}
                      day={day}
                      employees={marks.get(day) ?? []}
                      isToday={day === highlightToday}
                    />
                  ),
                )}
              </div>
              {markedDays.length === 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1.5 max-w-[11rem] leading-snug">
                  Sin cumpleaños este mes.
                </p>
              ) : null}
            </div>
            <div className="min-w-0 flex-1 border-t border-border/60 pt-3 sm:border-t-0 sm:border-l sm:border-border/60 sm:pt-0 sm:pl-3 md:pl-4">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Próximos
              </p>
              {upcoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin fechas de nacimiento.</p>
              ) : (
                <ul className="max-h-[6.5rem] sm:max-h-[7rem] overflow-y-auto space-y-0.5 pr-0.5 text-xs">
                  {upcoming.map((row) => {
                    const label = formatEmployeeName(row);
                    const nameEl =
                      canLinkEmployee ? (
                        <Link
                          to={`/colaboradores/${row.employee_id}`}
                          className="font-medium text-primary hover:underline underline-offset-2 truncate block"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className="font-medium truncate block">{label}</span>
                      );
                    return (
                      <li
                        key={row.employee_id}
                        className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0 border-b border-border/40 last:border-0 pb-0.5 last:pb-0"
                      >
                        <div className="min-w-0 flex-1">{nameEl}</div>
                        <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                          {formatAppDate(row.next_birthday_date)}
                          <span className="ml-1 text-muted-foreground/90">({row.turning_age})</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

type DayCellProps = {
  day: number;
  employees: DashboardBirthdayEmployee[];
  isToday: boolean;
};

function DayCell({ day, employees, isToday }: DayCellProps) {
  const hasBirthdays = employees.length > 0;
  const inner = (
    <div
      className={cn(
        "h-6 w-6 rounded text-[10px] flex items-center justify-center tabular-nums leading-none",
        isToday && "ring-1 ring-primary font-semibold",
        hasBirthdays && "bg-primary/15 text-primary font-medium",
      )}
    >
      {day}
    </div>
  );

  if (!hasBirthdays) {
    return <div className="flex items-center justify-center">{inner}</div>;
  }

  const names = employees.map((e) => formatEmployeeName(e)).join(", ");

  return (
    <div className="flex items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="p-0 border-0 bg-transparent cursor-default rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Cumpleaños día ${day}: ${names}`}
          >
            {inner}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <p className="text-[11px] font-medium mb-0.5">Día {day}</p>
          <ul className="text-[11px] space-y-0">
            {employees.map((e) => (
              <li key={e.id}>{formatEmployeeName(e)}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
