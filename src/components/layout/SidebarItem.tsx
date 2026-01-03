import { cn } from "@/lib/utils";
import { ICON_SIZES } from "@/lib/constants";
import { NavigationItem } from "@/types/navigation";
import { ComingSoonBadge } from "../ui/ComingSoonBadge";

interface SidebarItemProps {
  item: NavigationItem;
  isActive: boolean;
  isCollapsed: boolean;
  onClick: () => void;
}

export function SidebarItem({
  item,
  isActive,
  isCollapsed,
  onClick,
}: SidebarItemProps) {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      disabled={item.disabled}
      className={cn(
        "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] font-medium",
        isCollapsed && "justify-center px-2",
        isActive
          ? "bg-gradient-to-r from-pink-500/20 via-violet-500/20 to-blue-500/20 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
        item.disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
      )}
      title={isCollapsed ? item.label : undefined}
    >
      <Icon size={ICON_SIZES.md} className="shrink-0" />
      {!isCollapsed && (
        <span className="truncate">{item.label}</span>
      )}
      {!isCollapsed && item.disabled && (
        <span className="ml-auto">
          <ComingSoonBadge variant="short" />
        </span>
      )}
    </button>
  );
}
