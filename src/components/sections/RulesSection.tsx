import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { RuleItem } from "../RuleItem";
import { AddRuleDialog } from "../AddRuleDialog";
import { AddModeDialog } from "../AddModeDialog";
import { ModeIcon, type IconName } from "../IconPicker";
import { TranscriptionRule, TranscriptionMode, DEFAULT_MODES } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface RulesSectionProps {
  rules: TranscriptionRule[];
  customModes: TranscriptionMode[];
  activeMode: string;
  onToggle: (id: string) => void;
  onAdd: (title: string, description: string) => void;
  onUpdate: (id: string, updates: Partial<TranscriptionRule>) => void;
  onDelete: (id: string) => void;
  onUpdateActiveMode: (mode: string) => void;
  onAddMode: (name: string, description: string, prompt: string, icon?: IconName) => void;
  onUpdateMode: (id: string, updates: Partial<TranscriptionMode>) => void;
  onDeleteMode: (id: string) => void;
}

export function RulesSection({
  rules,
  customModes,
  activeMode,
  onToggle,
  onAdd,
  onUpdate,
  onDelete,
  onUpdateActiveMode,
  onAddMode,
  onUpdateMode,
  onDeleteMode,
}: RulesSectionProps) {
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [isModeDialogOpen, setIsModeDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TranscriptionRule | null>(null);
  const [editingMode, setEditingMode] = useState<TranscriptionMode | null>(null);
  const [modeToDelete, setModeToDelete] = useState<TranscriptionMode | null>(null);

  const allModes = [...DEFAULT_MODES, ...customModes];
  const selectedMode = allModes.find((m) => m.id === activeMode) ?? DEFAULT_MODES[0];

  const handleEditRule = (id: string) => {
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      setEditingRule(rule);
      setIsRuleDialogOpen(true);
    }
  };

  const handleCloseRuleDialog = () => {
    setIsRuleDialogOpen(false);
    setEditingRule(null);
  };

  const handleSaveRule = (title: string, description: string) => {
    onAdd(title, description);
  };

  const handleUpdateRule = (id: string, title: string, description: string) => {
    onUpdate(id, { title, description });
  };

  const handleEditMode = (mode: TranscriptionMode) => {
    setEditingMode(mode);
    setIsModeDialogOpen(true);
  };

  const handleCloseModeDialog = () => {
    setIsModeDialogOpen(false);
    setEditingMode(null);
  };

  const handleSaveMode = (name: string, description: string, prompt: string, icon?: IconName) => {
    onAddMode(name, description, prompt, icon);
  };

  const handleUpdateMode = (id: string, name: string, description: string, prompt: string, icon?: IconName) => {
    onUpdateMode(id, { name, description, prompt, icon });
  };

  const enabledCount = rules.filter((r) => r.enabled).length;
  const isRulesDisabled = activeMode !== "none";

  return (
    <SectionLayout
      title="Rules & Modes"
      description="Transform your transcriptions with AI-powered rules"
    >
      {/* Mode Selector */}
      <Card className="space-y-3">
        <div>
          <Label className="text-[13px]">Transformation Mode</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {selectedMode.description}
          </p>
        </div>

        {/* Toggle Buttons */}
        <div className="flex flex-wrap gap-2">
          {allModes.map((mode) => (
            <div key={mode.id} className="flex items-center gap-1">
              <button
                onClick={() => onUpdateActiveMode(mode.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  activeMode === mode.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {mode.icon && <ModeIcon icon={mode.icon} size={12} />}
                {mode.name}
              </button>
              {!mode.isBuiltIn && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleEditMode(mode)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                    title="Edit mode"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => setModeToDelete(mode)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                    title="Delete mode"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          onClick={() => setIsModeDialogOpen(true)}
          className="w-full"
          size="sm"
        >
          <Plus size={ICON_SIZES.sm} className="mr-1.5" />
          Add Custom Mode
        </Button>
      </Card>

      {/* Rules */}
      <Card className={cn("space-y-2.5", isRulesDisabled && "opacity-50 pointer-events-none")}>
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
              onEdit={handleEditRule}
              onDelete={onDelete}
            />
          ))}
        </div>

        <Button
          variant="secondary"
          onClick={() => setIsRuleDialogOpen(true)}
          className="w-full"
          size="sm"
          disabled={isRulesDisabled}
        >
          <Plus size={ICON_SIZES.sm} className="mr-1.5" />
          Add Custom Rule
        </Button>
      </Card>

      <AddRuleDialog
        isOpen={isRuleDialogOpen}
        onClose={handleCloseRuleDialog}
        onSave={handleSaveRule}
        editingRule={editingRule}
        onUpdate={handleUpdateRule}
      />

      <AddModeDialog
        isOpen={isModeDialogOpen}
        onClose={handleCloseModeDialog}
        onSave={handleSaveMode}
        editingMode={editingMode}
        onUpdate={handleUpdateMode}
      />

      <AlertDialog open={!!modeToDelete} onOpenChange={(open) => !open && setModeToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Mode</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{modeToDelete?.name}"? This action cannot be undone
              and the custom prompt will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (modeToDelete) {
                  onDeleteMode(modeToDelete.id);
                  setModeToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionLayout>
  );
}
