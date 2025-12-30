import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  capturing?: boolean;
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, capturing, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex-1 min-w-0 bg-input border border-border rounded-lg px-4 py-3 text-sm font-mono text-foreground transition-all placeholder:text-muted focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20",
          capturing && !error && "border-secondary animate-pulse-border",
          error && "border-red-500/70 bg-red-500/5 focus:border-red-500 focus:ring-red-500/20",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
