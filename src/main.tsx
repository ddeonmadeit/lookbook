import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Force HTTPS in production. Plain HTTP lets networks (carriers, public
// wi-fi) inject ads/scripts into the page; encrypted pages can't be tampered
// with. Runs before anything renders.
if (
  window.location.protocol === "http:" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
) {
  window.location.replace(window.location.href.replace(/^http:/, "https:"));
}

createRoot(document.getElementById("root")!).render(<App />);
