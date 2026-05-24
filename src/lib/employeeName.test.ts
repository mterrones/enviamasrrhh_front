import { describe, expect, it } from "vitest";
import { formatEmployeeFullName, formatEmployeeName } from "./employeeName";

describe("formatEmployeeName", () => {
  it("joins only first name and last name", () => {
    expect(
      formatEmployeeName({
        first_name: "Usuario",
        middle_name: "Carlos Demo",
        last_name: "EnviaMas",
        second_last_name: "García",
      }),
    ).toBe("Usuario EnviaMas");
  });

  it("omits empty parts", () => {
    expect(formatEmployeeName({ first_name: "Ana", last_name: "López" })).toBe("Ana López");
    expect(formatEmployeeName({ first_name: "Ana", last_name: null })).toBe("Ana");
  });
});

describe("formatEmployeeFullName", () => {
  it("joins all four name parts", () => {
    expect(
      formatEmployeeFullName({
        first_name: "Usuario",
        middle_name: "Carlos Demo",
        last_name: "EnviaMas",
        second_last_name: "García",
      }),
    ).toBe("Usuario Carlos Demo EnviaMas García");
  });

  it("omits empty parts", () => {
    expect(formatEmployeeFullName({ first_name: "Ana", last_name: "López" })).toBe("Ana López");
  });
});
