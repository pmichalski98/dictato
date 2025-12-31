import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Section } from "@/types/navigation";

interface AppLayoutProps {
  children: ReactNode;
  activeSection: Section;
  isCollapsed: boolean;
  onNavigate: (section: Section) => void;
  onToggleCollapsed: () => void;
}

export function AppLayout({
  children,
  activeSection,
  isCollapsed,
  onNavigate,
  onToggleCollapsed,
}: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeSection={activeSection}
        isCollapsed={isCollapsed}
        onNavigate={onNavigate}
        onToggleCollapsed={onToggleCollapsed}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
