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
    isDownloaded,
    isInstalling,
    downloadProgress,
    error,
    installAndRestart,
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
          isDownloaded={isDownloaded}
          isInstalling={isInstalling}
          downloadProgress={downloadProgress}
          error={error}
          onUpdate={installAndRestart}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

export default App;
