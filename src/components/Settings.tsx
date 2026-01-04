import { useSettings } from "../hooks/useSettings";
import { useNavigation } from "../hooks/useNavigation";
import { AppLayout } from "./layout/AppLayout";
import { GeneralSection } from "./sections/GeneralSection";
import { RecordingSection } from "./sections/RecordingSection";
import { RulesSection } from "./sections/RulesSection";
import { DictionarySection } from "./sections/DictionarySection";
import { HistorySection } from "./sections/HistorySection";

export function Settings() {
  const {
    settings,
    isLoading: isSettingsLoading,
    updateGroqApiKey,
    updateLanguage,
    updateShortcut,
    updateCancelShortcut,
    updateMicrophoneDeviceId,
    updateAutoPaste,
    updateActiveMode,
    toggleRule,
    addRule,
    updateRule,
    deleteRule,
    addMode,
    updateMode,
    deleteMode,
  } = useSettings();

  const {
    activeSection,
    isCollapsed,
    isLoading: isNavLoading,
    navigateTo,
    toggleCollapsed,
  } = useNavigation();

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
    >
      <div className={activeSection === "general" ? "block" : "hidden"}>
        <GeneralSection
          groqApiKey={settings.groqApiKey}
          onSaveApiKey={updateGroqApiKey}
        />
      </div>

      <div className={activeSection === "recording" ? "block" : "hidden"}>
        <RecordingSection
          language={settings.language}
          microphoneDeviceId={settings.microphoneDeviceId}
          autoPaste={settings.autoPaste}
          shortcut={settings.shortcut}
          cancelShortcut={settings.cancelShortcut}
          onUpdateLanguage={updateLanguage}
          onUpdateMicrophoneDeviceId={updateMicrophoneDeviceId}
          onUpdateAutoPaste={updateAutoPaste}
          onUpdateShortcut={updateShortcut}
          onUpdateCancelShortcut={updateCancelShortcut}
        />
      </div>

      <div className={activeSection === "rules" ? "block" : "hidden"}>
        <RulesSection
          rules={settings.transcriptionRules}
          customModes={settings.customModes}
          activeMode={settings.activeMode}
          onToggle={toggleRule}
          onAdd={addRule}
          onUpdate={updateRule}
          onDelete={deleteRule}
          onUpdateActiveMode={updateActiveMode}
          onAddMode={addMode}
          onUpdateMode={updateMode}
          onDeleteMode={deleteMode}
        />
      </div>

      <div className={activeSection === "dictionary" ? "block" : "hidden"}>
        <DictionarySection />
      </div>

      <div className={activeSection === "history" ? "block" : "hidden"}>
        <HistorySection />
      </div>
    </AppLayout>
  );
}
