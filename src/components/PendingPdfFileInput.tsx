import { useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PendingPdfFileInputProps = {
  pendingFile: File | null;
  onFileSelect: (file: File | null) => void;
  className?: string;
  inputClassName?: string;
  pendingMessagePrefix?: string;
  disabled?: boolean;
  id?: string;
};

export function PendingPdfFileInput({
  pendingFile,
  onFileSelect,
  className,
  inputClassName,
  pendingMessagePrefix = "Se subirá al guardar:",
  disabled,
  id,
}: PendingPdfFileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const clearSelection = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    onFileSelect(null);
  };

  return (
    <div className={cn("space-y-1", className)}>
      <Input
        ref={inputRef}
        id={id}
        type="file"
        accept=".pdf,application/pdf"
        className={cn("cursor-pointer", inputClassName)}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          onFileSelect(file);
        }}
      />
      {pendingFile ? (
        <div className="flex items-center gap-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate flex-1">
            {pendingMessagePrefix ? `${pendingMessagePrefix} ` : ""}
            {pendingFile.name}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Quitar archivo seleccionado"
            disabled={disabled}
            onClick={clearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
