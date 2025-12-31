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
    toggleRule,
    addRule,
    updateRule,
    deleteRule,
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

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return (
          <GeneralSection
            groqApiKey={settings.groqApiKey}
            onSaveApiKey={updateGroqApiKey}
          />
        );
      case "recording":
        return (
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
        );
      case "rules":
        return (
          <RulesSection
            rules={settings.transcriptionRules}
            onToggle={toggleRule}
            onAdd={addRule}
            onUpdate={updateRule}
            onDelete={deleteRule}
          />
        );
      case "dictionary":
        return <DictionarySection />;
      case "history":
        return <HistorySection />;
      default: {
        // Exhaustive check - TypeScript will error if a section is not handled
        const _exhaustiveCheck: never = activeSection;
        console.error(`Unknown section: ${_exhaustiveCheck}`);
        return null;
      }
    }
  };

  return (
    <AppLayout
      activeSection={activeSection}
      isCollapsed={isCollapsed}
      onNavigate={navigateTo}
      onToggleCollapsed={toggleCollapsed}
    >
      {renderSection()}
    </AppLayout>
  );
}
