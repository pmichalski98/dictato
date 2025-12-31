interface ComingSoonBadgeProps {
  variant?: "short" | "full";
}

export function ComingSoonBadge({ variant = "full" }: ComingSoonBadgeProps) {
  return (
    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
      {variant === "short" ? "Soon" : "Coming soon"}
    </span>
  );
}
