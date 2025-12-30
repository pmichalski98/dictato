import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { TranscriptionRule } from "@/hooks/useSettings";

interface AddRuleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (title: string, description: string) => void;
  editingRule?: TranscriptionRule | null;
  onUpdate?: (id: string, title: string, description: string) => void;
}

export function AddRuleDialog({
  isOpen,
  onClose,
  onSave,
  editingRule,
  onUpdate,
}: AddRuleDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (editingRule) {
      setTitle(editingRule.title);
      setDescription(editingRule.description);
    } else {
      setTitle("");
      setDescription("");
    }
  }, [editingRule, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    if (editingRule && onUpdate) {
      onUpdate(editingRule.id, title.trim(), description.trim());
    } else {
      onSave(title.trim(), description.trim());
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            {editingRule ? "Edit Rule" : "Add Custom Rule"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Remove Technical Jargon"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Simplify technical terms for general audience"
              rows={3}
              className="w-full bg-input border border-border rounded-md px-2.5 py-2 text-[13px] text-foreground transition-all placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !description.trim()}
              className="flex-1"
            >
              {editingRule ? "Save Changes" : "Add Rule"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
