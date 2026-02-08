// Global Tailwind + base styles so the single-file bundle includes CSS.
import "./index.css";

import { app } from "./app-instance.js";

app.connect();

import "./chat-vault/index.jsx";
