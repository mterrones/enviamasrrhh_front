import { describe, expect, it } from "vitest";
import { resolvePermission } from "@/contexts/AuthContext";

describe("resolvePermission", () => {
  it("uses API permissions when provided", () => {
    const allowedByRole = ["settings.users", "settings.departments"];
    const apiPermissions = ["settings.departments"];

    expect(resolvePermission("settings.users", allowedByRole, apiPermissions)).toBe(false);
    expect(resolvePermission("settings.departments", allowedByRole, apiPermissions)).toBe(true);
  });

  it("falls back to role defaults when API permissions are missing", () => {
    const allowedByRole = ["settings.users", "settings.departments"];

    expect(resolvePermission("settings.users", allowedByRole)).toBe(true);
    expect(resolvePermission("settings.params", allowedByRole)).toBe(false);
  });
});
