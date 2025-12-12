import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FloatingWindow } from "./components/FloatingWindow";

const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {windowType === "floating" ? <FloatingWindow /> : <App />}
  </React.StrictMode>
);
