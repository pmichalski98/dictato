import {
  Circle,
  Code,
  Mail,
  MessageSquare,
  FileText,
  Pencil,
  BookOpen,
  Briefcase,
  Coffee,
  Zap,
  Star,
  Heart,
  Smile,
  Users,
  Globe,
  Mic,
  Music,
  Camera,
  Video,
  Phone,
  Send,
  Inbox,
  Archive,
  Folder,
  File,
  Settings,
  Lightbulb,
  Target,
  Award,
  Trophy,
  Flag,
  Bookmark,
  Tag,
  Hash,
  AtSign,
  Link,
  Paperclip,
  Clock,
  Calendar,
  CheckCircle,
  AlertCircle,
  Info,
  HelpCircle,
  Terminal,
  Database,
  Server,
  Cloud,
  Download,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Map of icon names to components for optimized bundle size
const ICON_MAP = {
  Circle,
  Code,
  Mail,
  MessageSquare,
  FileText,
  Pencil,
  BookOpen,
  Briefcase,
  Coffee,
  Zap,
  Star,
  Heart,
  Smile,
  Users,
  Globe,
  Mic,
  Music,
  Camera,
  Video,
  Phone,
  Send,
  Inbox,
  Archive,
  Folder,
  File,
  Settings,
  Lightbulb,
  Target,
  Award,
  Trophy,
  Flag,
  Bookmark,
  Tag,
  Hash,
  AtSign,
  Link,
  Paperclip,
  Clock,
  Calendar,
  CheckCircle,
  AlertCircle,
  Info,
  HelpCircle,
  Terminal,
  Database,
  Server,
  Cloud,
  Download,
  Upload,
} as const;

export const AVAILABLE_ICONS = Object.keys(ICON_MAP) as IconName[];

export type IconName = keyof typeof ICON_MAP;

interface IconPickerProps {
  value?: IconName;
  onChange: (icon: IconName) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="grid grid-cols-8 gap-1 p-2 bg-muted/30 rounded-md max-h-[200px] overflow-y-auto">
      {AVAILABLE_ICONS.map((iconName) => {
        const IconComponent = ICON_MAP[iconName];

        return (
          <button
            key={iconName}
            type="button"
            onClick={() => onChange(iconName)}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-md transition-colors hover:bg-muted",
              value === iconName && "bg-primary/20 text-primary ring-1 ring-primary/50"
            )}
            title={iconName}
          >
            <IconComponent size={16} />
          </button>
        );
      })}
    </div>
  );
}

interface ModeIconProps {
  icon?: IconName | string;
  size?: number;
  className?: string;
}

export function ModeIcon({ icon, size = 14, className }: ModeIconProps) {
  if (!icon) return null;

  const IconComponent: LucideIcon | undefined = ICON_MAP[icon as IconName];

  // Fallback to HelpCircle if icon name is invalid
  if (!IconComponent) {
    console.warn(`Invalid icon name: ${icon}, using fallback`);
    return <HelpCircle size={size} className={className} />;
  }

  return <IconComponent size={size} className={className} />;
}
