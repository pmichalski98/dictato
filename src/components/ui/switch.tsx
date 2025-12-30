import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled = false, className }, ref) => {
    return (
      <button
        ref={ref}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-muted/60",
          className
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-3.5 w-3.5 rounded-full shadow-sm transition-all",
            checked ? "translate-x-[15px] bg-white" : "translate-x-0.5 bg-zinc-400"
          )}
        />
      </button>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
