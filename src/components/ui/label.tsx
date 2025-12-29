import * as React from "react";
import { cn } from "@/lib/utils";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "block text-xs font-medium text-muted-foreground uppercase tracking-widest",
          className
        )}
        {...props}
      />
    );
  }
);
Label.displayName = "Label";

export { Label };
