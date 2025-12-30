import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, disabled = false, className, id }, ref) => {
    return (
      <button
        ref={ref}
        id={id}
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "h-4 w-4 shrink-0 rounded border transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "bg-primary border-primary"
            : "bg-transparent border-muted-foreground/50 hover:border-muted-foreground",
          className
        )}
      >
        {checked && (
          <Check className="h-3 w-3 text-primary-foreground mx-auto" strokeWidth={3} />
        )}
      </button>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
