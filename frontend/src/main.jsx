import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { WorkspaceProvider } from "./context/WorkspaceContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);