import { Settings } from "./components/Settings";
import { UpdateDialog } from "./components/UpdateDialog";
import { useUpdateCheck } from "./hooks/useUpdateCheck";

function App() {
  const {
    available,
    currentVersion,
    newVersion,
    isDownloading,
    downloadAndInstall,
    dismiss,
  } = useUpdateCheck();

  return (
    <>
      <Settings />
      {available && (
        <UpdateDialog
          currentVersion={currentVersion}
          newVersion={newVersion}
          isDownloading={isDownloading}
          onUpdate={downloadAndInstall}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

export default App;
