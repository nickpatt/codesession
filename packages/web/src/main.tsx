import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HomePage } from "./pages/HomePage.js";
import { SessionPage } from "./pages/SessionPage.js";
import "./styles.css";

/**
 * App routes:
 *   /            -> landing page with "New Session"
 *   /s/:id       -> the collaborative editor for a given session
 */
const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/s/:id", element: <SessionPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
