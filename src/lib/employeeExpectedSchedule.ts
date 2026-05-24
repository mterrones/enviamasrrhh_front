import { formatEmployeeModalityDisplay } from "@/lib/employeeModalityCatalog";
import { attendanceTimeToMinutes } from "@/lib/attendanceTimeInput";

export type ExpectedWorkSchedule = {
  checkIn: string;
  checkOut: string;
  dailyMinutes: number;
};

const FULL_TIME_CANONICAL = "Full Time L-V (09:00 - 18:00)";

const SCHEDULE_BY_CANONICAL: Record<string, { checkIn: string; checkOut: string }> = {
  [FULL_TIME_CANONICAL]: { checkIn: "09:00", checkOut: "18:00" },
  "Part Time L-V (09:00 - 13:00)": { checkIn: "09:00", checkOut: "13:00" },
  "Part Time L-V (14:00 - 18:00)": { checkIn: "14:00", checkOut: "18:00" },
};

const LEGACY_SCHEDULE: Record<string, { checkIn: string; checkOut: string }> = {
  "Full Time (09:00 - 18:45)": { checkIn: "09:00", checkOut: "18:00" },
  "Part Time (09:00 - 14:00)": { checkIn: "09:00", checkOut: "13:00" },
  "Part Time (14:00 - 18:45)": { checkIn: "14:00", checkOut: "18:00" },
};

const DEFAULT_SLOT = SCHEDULE_BY_CANONICAL[FULL_TIME_CANONICAL];

function slotToSchedule(slot: { checkIn: string; checkOut: string }): ExpectedWorkSchedule {
  const inM = attendanceTimeToMinutes(slot.checkIn);
  const outM = attendanceTimeToMinutes(slot.checkOut);
  const dailyMinutes =
    inM !== null && outM !== null && outM >= inM ? outM - inM : 540;
  return { checkIn: slot.checkIn, checkOut: slot.checkOut, dailyMinutes };
}

function resolveSlot(modality: string): { checkIn: string; checkOut: string } | null {
  if (SCHEDULE_BY_CANONICAL[modality]) return SCHEDULE_BY_CANONICAL[modality];
  if (LEGACY_SCHEDULE[modality]) return LEGACY_SCHEDULE[modality];
  const canonical = formatEmployeeModalityDisplay(modality);
  if (canonical && SCHEDULE_BY_CANONICAL[canonical]) {
    return SCHEDULE_BY_CANONICAL[canonical];
  }
  return null;
}

export function resolveEmployeeExpectedSchedule(
  modality: string | null | undefined,
): ExpectedWorkSchedule {
  const raw = (modality ?? "").trim();
  if (!raw) return slotToSchedule(DEFAULT_SLOT);
  const slot = resolveSlot(raw);
  return slotToSchedule(slot ?? DEFAULT_SLOT);
}
