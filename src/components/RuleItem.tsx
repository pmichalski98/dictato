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
    <div className="flex items-center gap-4 py-3 px-1 border-b border-border last:border-b-0">
      <Switch
        checked={rule.enabled}
        onCheckedChange={() => onToggle(rule.id)}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground">{rule.title}</div>
        <div className="text-sm text-muted-foreground truncate">
          {rule.description}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onEdit(rule.id)}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          title="Edit rule"
        >
          <Pencil className="h-4 w-4" />
        </button>
        {!rule.isBuiltIn && (
          <button
            onClick={() => onDelete(rule.id)}
            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete rule"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
