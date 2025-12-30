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
          "flex-1 min-w-0 bg-input border border-border rounded-md h-8 px-2.5 text-[13px] font-mono text-foreground transition-all placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/30",
          capturing && !error && "border-secondary animate-pulse-border",
          error && "border-destructive/70 bg-destructive/5 focus:border-destructive focus:ring-destructive/20",
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
