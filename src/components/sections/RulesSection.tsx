import { useState, useMemo } from "react";
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
import { TranscriptionRule, TranscriptionMode } from "@/hooks/useSettings";
import { getVisibleModes, NONE_MODE_ID, DEFAULT_MODES } from "@/lib/modes";
import { cn } from "@/lib/utils";

interface RulesSectionProps {
  rules: TranscriptionRule[];
  customModes: TranscriptionMode[];
  activeMode: string;
  deletedBuiltInModes: string[];
  onToggle: (id: string) => void;
  onAdd: (title: string, description: string) => void;
  onUpdate: (id: string, updates: Partial<TranscriptionRule>) => void;
  onDelete: (id: string) => void;
  onUpdateActiveMode: (mode: string) => void;
  onAddMode: (name: string, description: string, prompt: string, icon?: IconName, isPromptCustom?: boolean) => void;
  onUpdateMode: (id: string, updates: Partial<TranscriptionMode>) => void;
  onDeleteMode: (id: string) => void;
  onDeleteBuiltInMode: (id: string) => void;
}

export function RulesSection({
  rules,
  customModes,
  activeMode,
  deletedBuiltInModes,
  onToggle,
  onAdd,
  onUpdate,
  onDelete,
  onUpdateActiveMode,
  onAddMode,
  onUpdateMode,
  onDeleteMode,
  onDeleteBuiltInMode,
}: RulesSectionProps) {
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [isModeDialogOpen, setIsModeDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TranscriptionRule | null>(null);
  const [editingMode, setEditingMode] = useState<TranscriptionMode | null>(null);
  const [modeToDelete, setModeToDelete] = useState<TranscriptionMode | null>(null);

  // Memoized visible modes list
  const allModes = useMemo(
    () => getVisibleModes(customModes, deletedBuiltInModes),
    [customModes, deletedBuiltInModes]
  );
  const selectedMode = allModes.find((m) => m.id === activeMode);
  const isNoModeActive = activeMode === NONE_MODE_ID || !selectedMode;

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
    if (mode.isBuiltIn) {
      // For built-in modes, create a copy with prompt for editing
      setEditingMode({
        ...mode,
        prompt: mode.prompt ?? "",
        isBuiltIn: false, // Will be saved as custom
        isPromptCustom: true,
      });
    } else {
      setEditingMode(mode);
    }
    setIsModeDialogOpen(true);
  };

  const handleCloseModeDialog = () => {
    setIsModeDialogOpen(false);
    setEditingMode(null);
  };

  const handleSaveMode = (name: string, description: string, prompt: string, icon?: IconName, isPromptCustom?: boolean) => {
    onAddMode(name, description, prompt, icon, isPromptCustom);
  };

  const handleUpdateMode = (id: string, name: string, description: string, prompt: string, icon?: IconName, isPromptCustom?: boolean) => {
    // Check if we're editing a built-in mode
    const originalMode = [...DEFAULT_MODES, ...customModes].find((m) => m.id === id);
    if (originalMode?.isBuiltIn) {
      // Delete the built-in mode and create a new custom one
      onDeleteBuiltInMode(id);
      onAddMode(name, description, prompt, icon, isPromptCustom);
    } else {
      onUpdateMode(id, { name, description, prompt, icon, isPromptCustom });
    }
  };

  const handleDeleteMode = (mode: TranscriptionMode) => {
    if (mode.isBuiltIn) {
      onDeleteBuiltInMode(mode.id);
    } else {
      onDeleteMode(mode.id);
    }
    setModeToDelete(null);
  };

  const handleModeClick = (modeId: string) => {
    // Toggle behavior: clicking active mode deactivates it
    if (activeMode === modeId) {
      onUpdateActiveMode(NONE_MODE_ID);
    } else {
      onUpdateActiveMode(modeId);
    }
  };

  const enabledCount = rules.filter((r) => r.enabled).length;
  const isRulesDisabled = !isNoModeActive;

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
            {selectedMode?.description ?? "No mode active - using individual rules"}
          </p>
        </div>

        {/* Mode List */}
        <div className="space-y-1.5">
          {allModes.map((mode) => (
            <div
              key={mode.id}
              className={cn(
                "flex items-center justify-between px-3 py-2 rounded-lg border transition-colors cursor-pointer",
                activeMode === mode.id
                  ? "bg-primary/10 border-primary/30 text-foreground"
                  : "bg-muted/30 border-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
              onClick={() => handleModeClick(mode.id)}
            >
              <div className="flex items-center gap-2.5">
                {mode.icon && (
                  <ModeIcon
                    icon={mode.icon}
                    size={16}
                    className={activeMode === mode.id ? "text-primary" : ""}
                  />
                )}
                <span className="text-[13px] font-medium">{mode.name}</span>
                {activeMode === mode.id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                    Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleEditMode(mode)}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                  title="Edit mode"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setModeToDelete(mode)}
                  className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  title="Delete mode"
                >
                  <Trash2 size={14} />
                </button>
              </div>
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
              Are you sure you want to delete "{modeToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (modeToDelete) {
                  handleDeleteMode(modeToDelete);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionLayout>
  );
}
