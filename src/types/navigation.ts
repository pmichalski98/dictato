import { ComponentType } from "react";

export type Section =
  | "general"
  | "recording"
  | "rules"
  | "transcribe"
  | "dictionary"
  | "history"
  | "cleaning";

export interface NavigationItem {
  id: Section;
  label: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  disabled?: boolean;
}
