import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 cursor-pointer font-sans shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-primary to-ring text-primary-foreground hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30 active:translate-y-0",
        secondary:
          "bg-input border border-border text-foreground hover:bg-border hover:border-muted",
        destructive:
          "bg-destructive/20 border border-destructive/40 text-destructive-foreground hover:bg-destructive/30",
        ghost: "hover:bg-input",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
