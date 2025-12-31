import { ComponentType } from "react";

export type Section = "general" | "recording" | "rules" | "dictionary" | "history";

export interface NavigationItem {
  id: Section;
  label: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  disabled?: boolean;
}
