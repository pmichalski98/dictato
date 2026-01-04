import { useState, useEffect } from "react";
import { Settings2, Mic, Sparkles, BookText, Clock, PanelLeftClose, PanelLeft } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { cn } from "@/lib/utils";
import { ICON_SIZES, SIDEBAR } from "@/lib/constants";
import { NavigationItem, Section } from "@/types/navigation";
import { SidebarItem } from "./SidebarItem";

const navigationItems: NavigationItem[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "recording", label: "Recording", icon: Mic },
  { id: "rules", label: "Rules & Modes", icon: Sparkles },
  { id: "dictionary", label: "Dictionary", icon: BookText, disabled: true },
  { id: "history", label: "History", icon: Clock, disabled: true },
];

interface SidebarProps {
  activeSection: Section;
  isCollapsed: boolean;
  onNavigate: (section: Section) => void;
  onToggleCollapsed: () => void;
}

export function Sidebar({
  activeSection,
  isCollapsed,
  onNavigate,
  onToggleCollapsed,
}: SidebarProps) {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-card border-r border-border transition-[width] duration-200 ease-in-out shrink-0",
        isCollapsed ? SIDEBAR.WIDTH_COLLAPSED : SIDEBAR.WIDTH_EXPANDED
      )}
    >
      {/* Header */}
      <div className={cn(
        "p-4 border-b border-border",
        isCollapsed && "p-3"
      )}>
        {isCollapsed ? (
          <img
            src="/dictato_icon_4_circle_wave.svg"
            alt="Dictato"
            className="w-8 h-8"
          />
        ) : (
          <>
            <h1 className="text-lg font-semibold bg-gradient-to-r from-pink-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
              Dictato
            </h1>
            <p className="text-muted-foreground text-[11px] mt-0.5">
              Voice to text, instantly
            </p>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navigationItems.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            isActive={activeSection === item.id}
            isCollapsed={isCollapsed}
            onClick={() => !item.disabled && onNavigate(item.id)}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border space-y-1">
        <button
          onClick={onToggleCollapsed}
          className={cn(
            "flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/30",
            isCollapsed && "justify-center px-2"
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeft size={ICON_SIZES.md} />
          ) : (
            <>
              <PanelLeftClose size={ICON_SIZES.md} />
              <span>Collapse</span>
            </>
          )}
        </button>
        {version && !isCollapsed && (
          <div className="px-3 py-1 text-[11px] text-muted-foreground/60">
            v{version}
          </div>
        )}
      </div>
    </aside>
  );
}
