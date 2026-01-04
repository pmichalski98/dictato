import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
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

interface AddModeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, description: string, prompt: string, icon?: IconName) => void;
  editingMode?: TranscriptionMode | null;
  onUpdate?: (id: string, name: string, description: string, prompt: string, icon?: IconName) => void;
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

  useEffect(() => {
    if (editingMode) {
      setName(editingMode.name);
      setDescription(editingMode.description);
      setPrompt(editingMode.prompt ?? "");
      setIcon(editingMode.icon as IconName | undefined);
    } else {
      setName("");
      setDescription("");
      setPrompt("");
      setIcon(undefined);
    }
    setShowIconPicker(false);
  }, [editingMode, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    if (editingMode && onUpdate) {
      onUpdate(editingMode.id, name.trim(), description.trim(), prompt.trim(), icon);
    } else {
      onSave(name.trim(), description.trim(), prompt.trim(), icon);
    }
    onClose();
  };

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
          <div className="flex gap-3">
            {/* Icon picker */}
            <div>
              <Label className="text-[11px]">Icon</Label>
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="mt-1.5 w-10 h-10 flex items-center justify-center border border-border rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                {icon ? (
                  <ModeIcon icon={icon} size={18} />
                ) : (
                  <span className="text-muted-foreground text-xs">+</span>
                )}
              </button>
            </div>

            {/* Name */}
            <div className="flex-1">
              <Label htmlFor="mode-name" className="text-[11px]">Name</Label>
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
            <Label htmlFor="mode-description" className="text-[11px]">Description</Label>
            <Input
              id="mode-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Friendly, conversational tone"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="mode-prompt" className="text-[11px]">System Prompt</Label>
            <textarea
              id="mode-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Instructions for how to transform the transcription..."
              rows={6}
              className="mt-1.5 w-full bg-input border border-border rounded-md px-2.5 py-2 text-[13px] text-foreground transition-all placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              The AI will use this prompt to transform your voice transcription.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !prompt.trim()}>
              {editingMode ? "Save Changes" : "Add Mode"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
