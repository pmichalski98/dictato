import { Settings } from "./components/Settings";
import { UpdateDialog } from "./components/UpdateDialog";
import { useUpdateCheck } from "./hooks/useUpdateCheck";

function App() {
  const {
    available,
    showDialog,
    currentVersion,
    newVersion,
    isDownloading,
    downloadAndInstall,
    openDialog,
    dismiss,
  } = useUpdateCheck();

  return (
    <>
      <Settings
        updateAvailable={available}
        newVersion={newVersion}
        onOpenUpdateDialog={openDialog}
      />
      {showDialog && (
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
