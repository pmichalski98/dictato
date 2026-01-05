import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { TranscriptionMode } from "@/hooks/useSettings";
import { IconPicker, ModeIcon, type IconName } from "./IconPicker";
import { generateModePrompt } from "@/lib/promptGenerator";
import { Loader2 } from "lucide-react";

interface AddModeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    description: string,
    prompt: string,
    icon?: IconName,
    isPromptCustom?: boolean
  ) => void;
  editingMode?: TranscriptionMode | null;
  onUpdate?: (
    id: string,
    name: string,
    description: string,
    prompt: string,
    icon?: IconName,
    isPromptCustom?: boolean
  ) => void;
}

export function AddModeDialog({
  isOpen,
  onClose,
  onSave,
  editingMode,
  onUpdate,
}: AddModeDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [icon, setIcon] = useState<IconName | undefined>(undefined);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When editing an existing mode with a prompt, always show the prompt editor
  const isEditing = !!editingMode;
  const hasExistingPrompt = isEditing && !!editingMode.prompt;

  useEffect(() => {
    if (editingMode) {
      setName(editingMode.name);
      setDescription(editingMode.description);
      setPrompt(editingMode.prompt ?? "");
      setIcon(editingMode.icon as IconName | undefined);
      // When editing, we don't need the toggle - prompt is always shown
      setUseCustomPrompt(false);
    } else {
      setName("");
      setDescription("");
      setPrompt("");
      setIcon(undefined);
      setUseCustomPrompt(false);
    }
    setShowIconPicker(false);
    setError(null);
  }, [editingMode, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // When editing or using custom prompt, require the prompt
    const needsPrompt = hasExistingPrompt || useCustomPrompt;
    if (needsPrompt && !prompt.trim()) return;

    setError(null);

    let finalPrompt = prompt.trim();
    let isPromptCustom = true;

    // Only generate prompt for new modes when not using custom prompt
    if (!isEditing && !useCustomPrompt) {
      setIsGenerating(true);
      try {
        finalPrompt = await generateModePrompt(name.trim(), description.trim());
        isPromptCustom = false;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to generate prompt"
        );
        return;
      } finally {
        setIsGenerating(false);
      }
    }

    // Save or update the mode
    if (editingMode && onUpdate) {
      onUpdate(
        editingMode.id,
        name.trim(),
        description.trim(),
        finalPrompt,
        icon,
        isPromptCustom
      );
    } else {
      onSave(
        name.trim(),
        description.trim(),
        finalPrompt,
        icon,
        isPromptCustom
      );
    }
    onClose();
  };

  // Validation: name is always required, prompt required when editing or using custom
  const needsPromptValidation = hasExistingPrompt || useCustomPrompt;
  const isSubmitDisabled =
    !name.trim() || (needsPromptValidation && !prompt.trim()) || isGenerating;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingMode ? "Edit Mode" : "Add Custom Mode"}
          </DialogTitle>
          <DialogDescription>
            Create a custom transformation mode with your own AI prompt.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-3 items-end">
            {/* Icon picker */}
            <div>
              <Label className="text-[11px]">Icon</Label>
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="mt-1.5 w-8 h-8 flex items-center justify-center border border-border rounded-md bg-input hover:bg-muted/50 transition-colors"
              >
                {icon ? (
                  <ModeIcon icon={icon} size={14} />
                ) : (
                  <span className="text-muted-foreground text-xs">+</span>
                )}
              </button>
            </div>

            {/* Name */}
            <div className="flex-1">
              <Label htmlFor="mode-name" className="text-[11px]">
                Name
              </Label>
              <Input
                id="mode-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Casual Chat"
                className="mt-1.5"
                autoFocus
              />
            </div>
          </div>

          {/* Icon picker dropdown */}
          {showIconPicker && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[11px]">Select Icon</Label>
                <button
                  type="button"
                  onClick={() => setShowIconPicker(false)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              <IconPicker
                value={icon}
                onChange={(newIcon) => {
                  setIcon(newIcon);
                  setShowIconPicker(false);
                }}
              />
            </div>
          )}

          <div>
            <Label htmlFor="mode-description" className="text-[11px]">
              Description
            </Label>
            <Textarea
              id="mode-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Friendly, conversational tone for casual messages"
              rows={2}
              className="mt-1.5"
            />
          </div>

          {/* When editing, always show the prompt. When adding new, show toggle */}
          {hasExistingPrompt ? (
            // Editing mode with existing prompt - always show prompt editor
            <div>
              <Label htmlFor="mode-prompt" className="text-[11px]">
                System Prompt
              </Label>
              <Textarea
                id="mode-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Instructions for how to transform the transcription..."
                rows={6}
                className="mt-1.5"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                The AI will use this prompt to transform your voice
                transcription.
              </p>
            </div>
          ) : (
            // Adding new mode - show toggle for auto-generate vs custom
            <>
              <div className="flex items-center justify-between">
                <Label className="text-[11px]">Use custom system prompt</Label>
                <Switch
                  checked={useCustomPrompt}
                  onCheckedChange={setUseCustomPrompt}
                />
              </div>

              {useCustomPrompt ? (
                <div>
                  <Label htmlFor="mode-prompt" className="text-[11px]">
                    System Prompt
                  </Label>
                  <Textarea
                    id="mode-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Instructions for how to transform the transcription..."
                    rows={6}
                    className="mt-1.5"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    The AI will use this prompt to transform your voice
                    transcription.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-muted/30 rounded-md border border-border">
                  <p className="text-[11px] text-muted-foreground">
                    The system prompt will be automatically generated based on
                    the mode name and description.
                  </p>
                </div>
              )}
            </>
          )}

          {error && <p className="text-[11px] text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitDisabled}>
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : editingMode ? (
                "Save Changes"
              ) : (
                "Add Mode"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
