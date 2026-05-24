import type { AttendanceStatus } from "@/api/attendance";
import {
  attendanceTimeToMinutes,
  classifyAttendanceTimeInput,
} from "@/lib/attendanceTimeInput";
import type { ExpectedWorkSchedule } from "@/lib/employeeExpectedSchedule";

export const ALL_ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "asistido",
  "recuperacion",
  "tardanza_j",
  "tardanza_nj",
  "falta_j",
  "falta_nj",
  "vacaciones",
];

export type AttendanceFormUi = {
  suggestedStatus: AttendanceStatus;
  statusDisabled: boolean;
  allowedStatuses: AttendanceStatus[];
  justificationDisabled: boolean;
  fileDisabled: boolean;
  partialTimeInvalid: boolean;
};

export function deriveAttendanceFormState(
  checkIn: string,
  checkOut: string,
  status: AttendanceStatus,
  schedule: ExpectedWorkSchedule,
): AttendanceFormUi {
  const inRaw = checkIn.trim();
  const outRaw = checkOut.trim();
  const inKind = classifyAttendanceTimeInput(checkIn);
  const outKind = classifyAttendanceTimeInput(checkOut);

  if (inKind === "invalid_partial" || outKind === "invalid_partial") {
    const allowed = ALL_ATTENDANCE_STATUSES.includes(status) ? [status] : ["falta_nj"];
    return {
      suggestedStatus: status,
      statusDisabled: true,
      allowedStatuses: allowed,
      justificationDisabled: true,
      fileDisabled: true,
      partialTimeInvalid: true,
    };
  }

  if (inKind === "empty_complete" && outKind === "empty_complete") {
    return {
      suggestedStatus: "falta_nj",
      statusDisabled: false,
      allowedStatuses: ["falta_nj", "falta_j", "vacaciones"],
      justificationDisabled: status !== "falta_j",
      fileDisabled: status !== "falta_j",
      partialTimeInvalid: false,
    };
  }

  if (inKind !== "valid" || outKind !== "valid") {
    const allowed = ALL_ATTENDANCE_STATUSES.includes(status) ? [status] : ["falta_nj"];
    return {
      suggestedStatus: status,
      statusDisabled: true,
      allowedStatuses: allowed,
      justificationDisabled: true,
      fileDisabled: true,
      partialTimeInvalid: true,
    };
  }

  const inM = attendanceTimeToMinutes(inRaw);
  const outM = attendanceTimeToMinutes(outRaw);
  if (inM === null || outM === null) {
    const allowed = ALL_ATTENDANCE_STATUSES.includes(status) ? [status] : ["falta_nj"];
    return {
      suggestedStatus: status,
      statusDisabled: true,
      allowedStatuses: allowed,
      justificationDisabled: true,
      fileDisabled: true,
      partialTimeInvalid: true,
    };
  }

  const mExpIn = attendanceTimeToMinutes(schedule.checkIn);
  const mExpOut = attendanceTimeToMinutes(schedule.checkOut);
  if (mExpIn === null || mExpOut === null) {
    return {
      suggestedStatus: "asistido",
      statusDisabled: false,
      allowedStatuses: ALL_ATTENDANCE_STATUSES,
      justificationDisabled: false,
      fileDisabled: false,
      partialTimeInvalid: false,
    };
  }

  if (inM === mExpIn && outM === mExpOut) {
    return {
      suggestedStatus: "asistido",
      statusDisabled: true,
      allowedStatuses: ["asistido"],
      justificationDisabled: true,
      fileDisabled: true,
      partialTimeInvalid: false,
    };
  }

  if (outM > mExpOut) {
    return {
      suggestedStatus: "recuperacion",
      statusDisabled: true,
      allowedStatuses: ["recuperacion"],
      justificationDisabled: true,
      fileDisabled: true,
      partialTimeInvalid: false,
    };
  }

  if (inM > mExpIn && outM === mExpOut) {
    return {
      suggestedStatus: "tardanza_j",
      statusDisabled: true,
      allowedStatuses: ["tardanza_j"],
      justificationDisabled: true,
      fileDisabled: true,
      partialTimeInvalid: false,
    };
  }

  if (outM < mExpOut) {
    return {
      suggestedStatus: "tardanza_nj",
      statusDisabled: false,
      allowedStatuses: ["tardanza_nj", "tardanza_j"],
      justificationDisabled: status !== "tardanza_j",
      fileDisabled: status !== "tardanza_j",
      partialTimeInvalid: false,
    };
  }

  return {
    suggestedStatus: "asistido",
    statusDisabled: false,
    allowedStatuses: ALL_ATTENDANCE_STATUSES,
    justificationDisabled: false,
    fileDisabled: false,
    partialTimeInvalid: false,
  };
}
