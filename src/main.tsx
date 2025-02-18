// import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import "@mantine/core/styles.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  // <StrictMode>
  <MantineProvider defaultColorScheme="dark">
    <Notifications />
    <ModalsProvider>
      <App />
    </ModalsProvider>
  </MantineProvider>
  // </StrictMode>
);
