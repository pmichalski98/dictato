import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Section } from "@/types/navigation";

interface AppLayoutProps {
  children: ReactNode;
  activeSection: Section;
  isCollapsed: boolean;
  onNavigate: (section: Section) => void;
  onToggleCollapsed: () => void;
  updateAvailable?: boolean;
  newVersion?: string;
  onOpenUpdateDialog?: () => void;
}

export function AppLayout({
  children,
  activeSection,
  isCollapsed,
  onNavigate,
  onToggleCollapsed,
  updateAvailable,
  newVersion,
  onOpenUpdateDialog,
}: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeSection={activeSection}
        isCollapsed={isCollapsed}
        onNavigate={onNavigate}
        onToggleCollapsed={onToggleCollapsed}
        updateAvailable={updateAvailable}
        newVersion={newVersion}
        onOpenUpdateDialog={onOpenUpdateDialog}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
