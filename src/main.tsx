import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FloatingWindow } from "./components/FloatingWindow";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

// Set transparent background for floating window
if (windowType === "floating") {
  document.body.classList.add("floating-window");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {windowType === "floating" ? <FloatingWindow /> : <App />}
  </React.StrictMode>
);
