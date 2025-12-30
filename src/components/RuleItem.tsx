import { Pencil, Trash2 } from "lucide-react";
import { Switch } from "./ui/switch";
import { TranscriptionRule } from "@/hooks/useSettings";

interface RuleItemProps {
  rule: TranscriptionRule;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function RuleItem({ rule, onToggle, onEdit, onDelete }: RuleItemProps) {
  return (
    <div className="flex items-center gap-2.5 py-2 px-2 border-b border-border last:border-b-0">
      <Switch
        checked={rule.enabled}
        onCheckedChange={() => onToggle(rule.id)}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground">{rule.title}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {rule.description}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onEdit(rule.id)}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/30"
          title="Edit rule"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {!rule.isBuiltIn && (
          <button
            onClick={() => onDelete(rule.id)}
            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded-md hover:bg-destructive/10"
            title="Delete rule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
