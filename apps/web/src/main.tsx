import React from "react";
import ReactDOM from "react-dom/client";
import { notifyDesktopShellReady } from "./core/desktop";
import "./styles.css";

void notifyDesktopShellReady();

void import("./app/App").then(({ App }) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
