import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FloatingWindow } from "./components/FloatingWindow";
import { CleaningOverlay } from "./components/CleaningOverlay";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

// Set transparent background for floating window
if (windowType === "floating") {
  document.body.classList.add("floating-window");
}

function renderRoot() {
  if (windowType === "floating") return <FloatingWindow />;
  if (windowType === "cleaning") return <CleaningOverlay />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderRoot()}</React.StrictMode>
);
