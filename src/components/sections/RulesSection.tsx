import { useState } from "react";
import { Plus } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { RuleItem } from "../RuleItem";
import { AddRuleDialog } from "../AddRuleDialog";
import { TranscriptionRule, DEFAULT_MODES } from "@/hooks/useSettings";

interface RulesSectionProps {
  rules: TranscriptionRule[];
  activeMode: string;
  onToggle: (id: string) => void;
  onAdd: (title: string, description: string) => void;
  onUpdate: (id: string, updates: Partial<TranscriptionRule>) => void;
  onDelete: (id: string) => void;
  onUpdateActiveMode: (mode: string) => void;
}

export function RulesSection({
  rules,
  activeMode,
  onToggle,
  onAdd,
  onUpdate,
  onDelete,
  onUpdateActiveMode,
}: RulesSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TranscriptionRule | null>(null);

  const selectedMode = DEFAULT_MODES.find((m) => m.id === activeMode) ?? DEFAULT_MODES[0];

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

  const isRulesDisabled = activeMode !== "none";

  return (
    <SectionLayout
      title="Rules & Modes"
      description="Transform your transcriptions with AI-powered rules"
    >
      {/* Mode Selector */}
      <Card className="space-y-2.5">
        <div>
          <Label className="text-[13px]">Transformation Mode</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {selectedMode.description}
          </p>
        </div>

        <Select
          value={activeMode}
          onChange={(e) => onUpdateActiveMode(e.target.value)}
        >
          {DEFAULT_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.name}
            </option>
          ))}
        </Select>
      </Card>

      {/* Rules */}
      <Card className={`space-y-2.5 ${isRulesDisabled ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-[13px]">Transcription Rules</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isRulesDisabled
                ? "Rules are disabled when a mode is active"
                : enabledCount > 0
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
          disabled={isRulesDisabled}
        >
          <Plus size={ICON_SIZES.sm} className="mr-1.5" />
          Add Custom Rule
        </Button>
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
