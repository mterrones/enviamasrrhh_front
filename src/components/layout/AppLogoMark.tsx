import { UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

type AppLogoMarkProps = {
  size?: "sm" | "md";
  className?: string;
};

const sizeStyles = {
  sm: { box: "w-9 h-9 rounded-lg", icon: "w-5 h-5" },
  md: { box: "w-12 h-12 rounded-xl", icon: "w-6 h-6" },
} as const;

export function AppLogoMark({ size = "sm", className }: AppLogoMarkProps) {
  const styles = sizeStyles[size];

  return (
    <div
      className={cn(styles.box, "gradient-primary flex items-center justify-center shrink-0", className)}
      aria-hidden
    >
      <UsersRound className={cn(styles.icon, "text-primary-foreground")} strokeWidth={2.25} />
    </div>
  );
}
