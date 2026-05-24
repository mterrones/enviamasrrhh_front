import { Badge } from "@/components/ui/badge";
import type { Payslip } from "@/api/payroll";
import type { PayslipSunatDisplay } from "@/lib/payslipSunatDisplay";
import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

type PayslipSunatPreviewProps = {
  payslip: Payslip;
  sunatDisplay: PayslipSunatDisplay;
  statusBadgeClassName?: string;
};

function FieldCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("border border-border px-2 py-1 min-h-[2rem]", className)}>
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[11.5px] font-medium break-words">{value}</p>
    </div>
  );
}

function SectionHeader({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <div
      className={cn(
        "border border-border px-2 py-1 text-center text-[10.5px] font-bold uppercase tracking-wide",
        variant === "primary" ? "bg-[#EFC38F] text-[#2E2115]" : "bg-[#E5A966] text-[#2E2115]",
      )}
    >
      {children}
    </div>
  );
}

function FinancialTable({ data }: { data: PayslipSunatDisplay }) {
  const getDeductionLabel = (label?: string) => {
    if (!label) {
      return "";
    }
    return label === "Total descuento AFP" ? "Subtotal AFP (aporte + prima + comision)" : label;
  };

  const isAfpSubItem = (label?: string) =>
    label === "Aporte obligatorio AFP" || label === "Prima de seguro AFP" || label?.startsWith("Comisión AFP") === true;

  const isAfpSubtotal = (label?: string) => label === "Total descuento AFP";

  const rows = Array.from({ length: data.financialRowCount }, (_, i) => ({
    earn: data.breakdownEarnings[i],
    ded: data.breakdownDeductions[i],
    emp: data.breakdownEmployerContributions[i],
  }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px] min-w-[640px]">
        <thead>
          <tr>
            <th colSpan={3} className="border border-border bg-muted px-2 py-1 text-center font-bold">
              REMUNERACIONES
            </th>
            <th colSpan={3} className="border border-border bg-muted px-2 py-1 text-center font-bold">
              RETENCIONES / DESCUENTOS
            </th>
            <th colSpan={2} className="border border-border bg-muted px-2 py-1 text-center font-bold">
              APORTACIONES DEL EMPLEADOR
            </th>
          </tr>
          <tr className="bg-muted/60">
            <th className="border border-border px-2 py-1 text-left font-semibold">Concepto</th>
            <th className="border border-border px-2 py-1 text-center font-semibold w-10">%</th>
            <th className="border border-border px-2 py-1 text-right font-semibold w-20">Monto</th>
            <th className="border border-border px-2 py-1 text-left font-semibold">Concepto</th>
            <th className="border border-border px-2 py-1 text-center font-semibold w-10">%</th>
            <th className="border border-border px-2 py-1 text-right font-semibold w-20">Monto</th>
            <th className="border border-border px-2 py-1 text-left font-semibold">Concepto</th>
            <th className="border border-border px-2 py-1 text-right font-semibold w-24">Monto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="border border-border px-2 py-1">{row.earn?.label ?? ""}</td>
              <td className="border border-border px-2 py-1 text-center">{row.earn?.ratio ?? ""}</td>
              <td className="border border-border px-2 py-1 text-right tabular-nums">{row.earn?.amount ?? ""}</td>
              <td
                className={cn(
                  "border border-border px-2 py-1",
                  isAfpSubItem(row.ded?.label) && "pl-4 text-[#4B3A2B]",
                  isAfpSubtotal(row.ded?.label) && "bg-[#FAE8D0] font-semibold border-t border-t-dashed border-t-[#CF9E5C]",
                )}
              >
                {getDeductionLabel(row.ded?.label)}
              </td>
              <td
                className={cn(
                  "border border-border px-2 py-1 text-center",
                  isAfpSubtotal(row.ded?.label) && "bg-[#FAE8D0] font-semibold border-t border-t-dashed border-t-[#CF9E5C]",
                )}
              >
                {row.ded?.ratio ?? ""}
              </td>
              <td
                className={cn(
                  "border border-border px-2 py-1 text-right tabular-nums text-destructive",
                  isAfpSubtotal(row.ded?.label) && "bg-[#FAE8D0] font-semibold border-t border-t-dashed border-t-[#CF9E5C]",
                )}
              >
                {row.ded?.amount ?? ""}
              </td>
              <td className="border border-border px-2 py-1">{row.emp?.label ?? ""}</td>
              <td className="border border-border px-2 py-1 text-right tabular-nums">{row.emp?.amount ?? ""}</td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <td className="border border-border px-2 py-1">TOTAL REMUNERACIONES</td>
            <td className="border border-border px-2 py-1" />
            <td className="border border-border px-2 py-1 text-right tabular-nums">{data.totalEarnings}</td>
            <td className="border border-border px-2 py-1">TOTAL DESCUENTOS</td>
            <td className="border border-border px-2 py-1" />
            <td className="border border-border px-2 py-1 text-right tabular-nums text-destructive">
              {data.totalDeductions}
            </td>
            <td className="border border-border px-2 py-1">TOTAL APORTACIONES</td>
            <td className="border border-border px-2 py-1 text-right tabular-nums">{data.totalEmployer}</td>
          </tr>
          <tr>
            <td colSpan={6} className="border border-border px-2 py-2 text-right font-bold text-[13.5px]">
              NETO A PAGAR
            </td>
            <td colSpan={2} className="border border-border px-2 py-2 text-right font-bold text-[15.5px] text-primary tabular-nums">
              {data.net}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PayslipSunatPreview({
  payslip,
  sunatDisplay,
  statusBadgeClassName,
}: PayslipSunatPreviewProps) {
  const data = sunatDisplay;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-background">
      <div className="text-center space-y-0.5">
        <p className="text-[15.5px] font-bold tracking-wide">BOLETA DE PAGO</p>
        <p className="text-[9.5px] text-muted-foreground">ART. 19 DEL DECRETO SUPREMO Nº 001-98-TR DEL 22-01-98</p>
        <p className="text-[13.5px] font-bold">{data.periodTitle}</p>
      </div>

      <div className="flex flex-col items-end gap-1">
        <p className="text-[11.5px]">
          <span className="font-semibold">Fecha de emisión / pago:</span> {data.issuedAt}
        </p>
        <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted-foreground">Estado boleta</span>
        <Badge variant="secondary" className={cn("text-[11.5px] font-medium border", statusBadgeClassName)}>
          {payslip.status === "aprobada"
            ? "Aprobada"
            : payslip.status === "pendiente"
              ? "Pendiente"
              : payslip.status}
        </Badge>
        </div>
      </div>

      <div>
        <SectionHeader>Datos de la empresa</SectionHeader>
        <div className="grid grid-cols-2 md:grid-cols-4">
          <FieldCell label="RUC" value={data.companyRuc} />
          <FieldCell label="Razón social" value={data.companyName} className="md:col-span-1" />
          <FieldCell label="Rubro de la empresa" value={data.companyRubro} />
          <FieldCell label="Dirección" value={data.companyAddress} />
        </div>
      </div>

      <div>
        <SectionHeader variant="secondary">Datos del trabajador</SectionHeader>
        <div className="grid grid-cols-2 md:grid-cols-6">
          <FieldCell label="Código" value={data.employeeCode} />
          <FieldCell label="Nombres" value={data.employeeFirstNames} className="md:col-span-2" />
          <FieldCell label="Apellidos" value={data.employeeLastNames} className="md:col-span-2" />
          <FieldCell label="D.N.I." value={`${data.employeeDocumentType}: ${data.employeeDni}`} />
          <FieldCell label="F. Nac." value={data.employeeBirthDate} />
          <FieldCell label="Hijos" value={data.employeeDependents} />
          <FieldCell label="Dirección" value={data.employeeAddress} className="md:col-span-4" />
        </div>
      </div>

      <div>
        <SectionHeader>Datos vinculados a la relación laboral</SectionHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
          <FieldCell label="Cargo" value={data.position} className="md:col-span-2" />
          <FieldCell label="Categoría" value={data.category} />
          <FieldCell label="Periodic." value={data.periodicity} />
          <FieldCell label="ONP" value={data.onpMark || "—"} className="text-center" />
          <FieldCell label="A.F.P." value={data.afpName} className="md:col-span-2" />
          <FieldCell label="C.U.S.P.P." value={data.cuspp} className="md:col-span-2" />
          <FieldCell label="F. Ing." value={data.contractStart} />
          <FieldCell label="F. Cese" value={data.contractEnd} />
          <FieldCell label="Ini. Vac." value={data.vacationStart} />
          <FieldCell label="Fin Vac." value={data.vacationEnd} />
          <FieldCell label="Días Vac." value={data.vacationDays} />
          <FieldCell label="Días laborados" value={data.daysWorked} />
          <FieldCell label="Total horas" value={data.totalHours} />
          <FieldCell label="Horas extras" value={data.overtimeHours} />
          <FieldCell label="Días no lab." value={data.daysNotWorked} />
          <FieldCell label="Otro empleador" value={data.otherEmployer} className="md:col-span-2" />
          <FieldCell label="Importe remun." value={data.otherEmployerAmount} />
          <FieldCell label="Cta depósito" value={data.bankAccount} className="md:col-span-3" />
        </div>
      </div>

      <FinancialTable data={data} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div className="border border-dashed border-border rounded-md p-2.5 text-center min-h-[130px] flex flex-col justify-end">
          <div className="h-[78px] flex items-end justify-center mb-2">
            {data.employerSignatureDataUri ? (
              <img src={data.employerSignatureDataUri} alt="Firma empleador" className="max-h-[74px] max-w-[240px] object-contain" />
            ) : null}
          </div>
          <div className="border-t border-foreground/40 pt-1">
            <p className="text-[11.5px] font-semibold">{data.employerSignerName}</p>
            <p className="text-[11px] text-muted-foreground">Firma del empleador</p>
          </div>
        </div>
        <div className="border border-dashed border-border rounded-md p-2.5 text-center min-h-[130px] flex flex-col justify-end">
          <div className="h-[78px] flex items-end justify-center mb-2">
            {data.employeeSignatureDataUri ? (
              <img src={data.employeeSignatureDataUri} alt="Firma colaborador" className="max-h-[74px] max-w-[240px] object-contain" />
            ) : null}
          </div>
          <div className="border-t border-foreground/40 pt-1">
            <p className="text-[11.5px] font-semibold">{data.employeeSignerName}</p>
            <p className="text-[11px] text-muted-foreground">Firma del colaborador</p>
          </div>
        </div>
      </div>
    </div>
  );
}
