import { describe, expect, it } from "vitest";
import { resolveEmployeeExpectedSchedule } from "@/lib/employeeExpectedSchedule";

describe("resolveEmployeeExpectedSchedule", () => {
  it("resolves full time canonical", () => {
    const s = resolveEmployeeExpectedSchedule("Full Time L-V (09:00 - 18:00)");
    expect(s.checkIn).toBe("09:00");
    expect(s.checkOut).toBe("18:00");
    expect(s.dailyMinutes).toBe(540);
  });

  it("resolves part time morning", () => {
    const s = resolveEmployeeExpectedSchedule("Part Time L-V (09:00 - 13:00)");
    expect(s.checkIn).toBe("09:00");
    expect(s.checkOut).toBe("13:00");
    expect(s.dailyMinutes).toBe(240);
  });

  it("resolves part time afternoon", () => {
    const s = resolveEmployeeExpectedSchedule("Part Time L-V (14:00 - 18:00)");
    expect(s.checkIn).toBe("14:00");
    expect(s.checkOut).toBe("18:00");
    expect(s.dailyMinutes).toBe(240);
  });

  it("maps legacy full time label to 18:00 checkout", () => {
    const s = resolveEmployeeExpectedSchedule("Full Time (09:00 - 18:45)");
    expect(s.checkOut).toBe("18:00");
    expect(s.dailyMinutes).toBe(540);
  });

  it("defaults to full time when modality is empty", () => {
    const s = resolveEmployeeExpectedSchedule(null);
    expect(s.checkIn).toBe("09:00");
    expect(s.checkOut).toBe("18:00");
  });
});
