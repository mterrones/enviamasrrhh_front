import { describe, expect, it } from "vitest";
import { deriveAttendanceFormState } from "@/lib/attendanceFormState";
import { resolveEmployeeExpectedSchedule } from "@/lib/employeeExpectedSchedule";

describe("deriveAttendanceFormState", () => {
  const fullTime = resolveEmployeeExpectedSchedule("Full Time L-V (09:00 - 18:00)");

  it("marks asistido when times match full time expected schedule", () => {
    const ui = deriveAttendanceFormState("09:00", "18:00", "asistido", fullTime);
    expect(ui.suggestedStatus).toBe("asistido");
    expect(ui.statusDisabled).toBe(true);
  });

  it("does not treat 18:45 as asistido for full time", () => {
    const ui = deriveAttendanceFormState("09:00", "18:45", "asistido", fullTime);
    expect(ui.suggestedStatus).not.toBe("asistido");
    expect(ui.suggestedStatus).toBe("recuperacion");
  });

  it("marks tardanza_nj on early leave for full time", () => {
    const ui = deriveAttendanceFormState("09:00", "17:00", "asistido", fullTime);
    expect(ui.suggestedStatus).toBe("tardanza_nj");
  });

  it("uses afternoon part time schedule", () => {
    const pt = resolveEmployeeExpectedSchedule("Part Time L-V (14:00 - 18:00)");
    const ui = deriveAttendanceFormState("14:00", "18:00", "asistido", pt);
    expect(ui.suggestedStatus).toBe("asistido");
    expect(ui.statusDisabled).toBe(true);
  });
});
