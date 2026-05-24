import { Download, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type EmployeeDocumentActionBarProps = {
  filename: string;
  busy?: boolean;
  canDelete?: boolean;
  onView: () => void;
  onDownload: () => void;
  onDelete?: () => void;
  className?: string;
};

export function EmployeeDocumentActionBar({
  filename,
  busy = false,
  canDelete = false,
  onView,
  onDownload,
  onDelete,
  className,
}: EmployeeDocumentActionBarProps) {
  return (
    <div className={cn("flex items-center gap-1 min-w-0", className)}>
      <p className="text-xs text-muted-foreground truncate flex-1 min-w-0" title={filename}>
        {filename}
      </p>
      <div className="flex items-center shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={busy}
              aria-label="Ver documento"
              onClick={onView}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ver</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={busy}
              aria-label="Descargar documento"
              onClick={onDownload}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Descargar</TooltipContent>
        </Tooltip>
        {canDelete && onDelete ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                disabled={busy}
                aria-label="Eliminar documento"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Eliminar</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
