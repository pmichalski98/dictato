import { useState } from "react";
import { Plus } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { RuleItem } from "../RuleItem";
import { AddRuleDialog } from "../AddRuleDialog";
import { ComingSoonBadge } from "../ui/ComingSoonBadge";
import { TranscriptionRule } from "@/hooks/useSettings";

interface RulesSectionProps {
  rules: TranscriptionRule[];
  onToggle: (id: string) => void;
  onAdd: (title: string, description: string) => void;
  onUpdate: (id: string, updates: Partial<TranscriptionRule>) => void;
  onDelete: (id: string) => void;
}

export function RulesSection({
  rules,
  onToggle,
  onAdd,
  onUpdate,
  onDelete,
}: RulesSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TranscriptionRule | null>(null);

  const handleEdit = (id: string) => {
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      setEditingRule(rule);
      setIsDialogOpen(true);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingRule(null);
  };

  const handleSave = (title: string, description: string) => {
    onAdd(title, description);
  };

  const handleUpdate = (id: string, title: string, description: string) => {
    onUpdate(id, { title, description });
  };

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <SectionLayout
      title="Rules & Modes"
      description="Transform your transcriptions with AI-powered rules"
    >
      {/* Rules */}
      <Card className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-[13px]">Transcription Rules</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {enabledCount > 0
                ? `${enabledCount} rule${enabledCount > 1 ? "s" : ""} active`
                : "Enable rules to polish your transcriptions"}
            </p>
          </div>
        </div>

        <div className="border border-border rounded-md divide-y divide-border">
          {rules.map((rule) => (
            <RuleItem
              key={rule.id}
              rule={rule}
              onToggle={onToggle}
              onEdit={handleEdit}
              onDelete={onDelete}
            />
          ))}
        </div>

        <Button
          variant="secondary"
          onClick={() => setIsDialogOpen(true)}
          className="w-full"
          size="sm"
        >
          <Plus size={ICON_SIZES.sm} className="mr-1.5" />
          Add Custom Rule
        </Button>
      </Card>

      {/* Modes - Future */}
      <Card className="space-y-3 opacity-50">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label>Modes</Label>
            <ComingSoonBadge />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Specialized transformation modes like Email, Technical Writing, and more.
            Unlike rules, modes are selected per-transcription.
          </p>
        </div>
      </Card>

      <AddRuleDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onSave={handleSave}
        editingRule={editingRule}
        onUpdate={handleUpdate}
      />
    </SectionLayout>
  );
}
