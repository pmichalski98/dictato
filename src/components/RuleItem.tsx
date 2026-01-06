import { Pencil, Trash2 } from "lucide-react";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { TranscriptionRule } from "@/hooks/useSettings";
import { ICON_SIZES } from "@/lib/constants";

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
        <div className="text-[13px] font-medium text-foreground">
          {rule.title}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {rule.description}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(rule.id)}
          className="h-7 w-7"
          title="Edit rule"
        >
          <Pencil size={ICON_SIZES.sm} />
        </Button>
        {!rule.isBuiltIn && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(rule.id)}
            className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
            title="Delete rule"
          >
            <Trash2 size={ICON_SIZES.sm} />
          </Button>
        )}
      </div>
    </div>
  );
}
