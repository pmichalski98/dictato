import { isCloudLlmProvider, useSettings } from "../hooks/useSettings";
import { useNavigation } from "../hooks/useNavigation";
import { useLocalModels } from "../hooks/useLocalModels";
import { AppLayout } from "./layout/AppLayout";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { RecordingSection } from "./sections/RecordingSection";
import { RulesSection } from "./sections/RulesSection";
import { TranscribeSection } from "./sections/TranscribeSection";
import { DictionarySection } from "./sections/DictionarySection";
import { HistorySection } from "./sections/HistorySection";
import { CleaningModeSection } from "./sections/CleaningModeSection";

interface SettingsProps {
  updateAvailable?: boolean;
  newVersion?: string;
  onOpenUpdateDialog?: () => void;
}

export function Settings({
  updateAvailable,
  newVersion,
  onOpenUpdateDialog,
}: SettingsProps) {
  const {
    settings,
    isLoading: isSettingsLoading,
    updateSttProvider,
    updateGroqApiKey,
    updateOpenaiApiKey,
    updateGoogleApiKey,
    updateAnthropicApiKey,
    updateLlmProvider,
    updateLlmModel,
    updateLanguage,
    updateShortcut,
    updateCancelShortcut,
    updateMicrophoneDeviceId,
    updateAutoPaste,
    updatePurePasteEnabled,
    updatePurePasteShortcut,
    updateActiveMode,
    toggleRule,
    addRule,
    updateRule,
    deleteRule,
    addMode,
    updateMode,
    deleteMode,
    deleteBuiltInMode,
  } = useSettings();

  const {
    activeSection,
    isCollapsed,
    isLoading: isNavLoading,
    navigateTo,
    toggleCollapsed,
  } = useNavigation();

  const localModels = useLocalModels();

  // Whether rules and modes can actually run with the selected AI provider
  const llmReady = isCloudLlmProvider(settings.llmProvider)
    ? !!{
        openai: settings.openaiApiKey,
        google: settings.googleApiKey,
        anthropic: settings.anthropicApiKey,
      }[settings.llmProvider]
    : localModels.models.some(
        (m) => m.id === settings.llmProvider && m.downloaded
      );

  if (isSettingsLoading || isNavLoading) {
    return (
      <div className="min-h-screen bg-background p-5 flex items-center justify-center text-muted-foreground text-[13px]">
        Loading...
      </div>
    );
  }

  return (
    <AppLayout
      activeSection={activeSection}
      isCollapsed={isCollapsed}
      onNavigate={navigateTo}
      onToggleCollapsed={toggleCollapsed}
      updateAvailable={updateAvailable}
      newVersion={newVersion}
      onOpenUpdateDialog={onOpenUpdateDialog}
    >
      <div className={activeSection === "general" ? "block" : "hidden"}>
        <GeneralSection
          sttProvider={settings.sttProvider}
          groqApiKey={settings.groqApiKey}
          openaiApiKey={settings.openaiApiKey}
          googleApiKey={settings.googleApiKey}
          anthropicApiKey={settings.anthropicApiKey}
          llmProvider={settings.llmProvider}
          llmModels={settings.llmModels}
          onUpdateSttProvider={updateSttProvider}
          onSaveGroqApiKey={updateGroqApiKey}
          onSaveOpenaiApiKey={updateOpenaiApiKey}
          onSaveGoogleApiKey={updateGoogleApiKey}
          onSaveAnthropicApiKey={updateAnthropicApiKey}
          onUpdateLlmProvider={updateLlmProvider}
          onUpdateLlmModel={updateLlmModel}
          localModels={localModels.models}
          onNavigate={navigateTo}
        />
      </div>

      <div className={activeSection === "models" ? "block" : "hidden"}>
        <ModelsSection
          localModels={localModels}
          sttProvider={settings.sttProvider}
          llmProvider={settings.llmProvider}
          onUpdateSttProvider={updateSttProvider}
          onUpdateLlmProvider={updateLlmProvider}
        />
      </div>

      <div className={activeSection === "recording" ? "block" : "hidden"}>
        <RecordingSection
          language={settings.language}
          microphoneDeviceId={settings.microphoneDeviceId}
          autoPaste={settings.autoPaste}
          purePasteEnabled={settings.purePasteEnabled}
          purePasteShortcut={settings.purePasteShortcut}
          shortcut={settings.shortcut}
          cancelShortcut={settings.cancelShortcut}
          onUpdateLanguage={updateLanguage}
          onUpdateMicrophoneDeviceId={updateMicrophoneDeviceId}
          onUpdateAutoPaste={updateAutoPaste}
          onUpdatePurePasteEnabled={updatePurePasteEnabled}
          onUpdatePurePasteShortcut={updatePurePasteShortcut}
          onUpdateShortcut={updateShortcut}
          onUpdateCancelShortcut={updateCancelShortcut}
        />
      </div>

      <div className={activeSection === "rules" ? "block" : "hidden"}>
        <RulesSection
          rules={settings.transcriptionRules}
          customModes={settings.customModes}
          activeMode={settings.activeMode}
          deletedBuiltInModes={settings.deletedBuiltInModes}
          llmReady={llmReady}
          onToggle={toggleRule}
          onAdd={addRule}
          onUpdate={updateRule}
          onDelete={deleteRule}
          onUpdateActiveMode={updateActiveMode}
          onAddMode={addMode}
          onUpdateMode={updateMode}
          onDeleteMode={deleteMode}
          onDeleteBuiltInMode={deleteBuiltInMode}
        />
      </div>

      <div className={activeSection === "transcribe" ? "block" : "hidden"}>
        <TranscribeSection />
      </div>

      <div className={activeSection === "dictionary" ? "block" : "hidden"}>
        <DictionarySection />
      </div>

      <div className={activeSection === "history" ? "block" : "hidden"}>
        <HistorySection />
      </div>

      <div className={activeSection === "cleaning" ? "block" : "hidden"}>
        <CleaningModeSection />
      </div>
    </AppLayout>
  );
}
