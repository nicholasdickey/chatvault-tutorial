# Build a SaaS ChatGPT App from Scratch with Vibe Engineering using Cursor Code Agent and No‑Code Tools

This repository is the starter project for the video series:

> **“Build a SaaS ChatGPT App from Scratch with Vibe Engineering, OpenAI Apps SDK, and No‑Code Tools”**

Use it to follow along with the tutorials or as a jumpstart template for your own SaaS ChatGPT app.

---

## What you'll build

Across the series, we’ll go from **zero to a deployable SaaS ChatGPT app**, including:

- **A ChatVault widget app** you can embed in ChatGPT. ChatVault is a tutorial app that will be able to save and access chats similar to browser history.
- **Multiple backend options for ChatVault** (code + no‑code) for your ChatGPT-style app:
  - Vibe coding (e.g., Node/TypeScript)
  - n8n
  - Make
  - Zapier + Agent Kit
- **A SaaS layer** powered by **Findexar** (SaaS‑in‑a‑bottle).
- **Production deployment** using GitHub, CI/CD, and Vercel.

You can adapt the stack and tools as you like—the repo is meant as a starting point, not a constraint.

---

## Series overview

### Part 1 — ChatVault Widget (Vibe Coding in Cursor)

We build a **ChatVault ChatGPT app widget** from scratch using vibe coding in Cursor:

- Set up a minimal frontend / MCP-UI (skybridge) project using OpenAI Apps SDK.
- Create an embeddable widget UI.
- Stub backend endpoints.
- Debug in ChatGPT.

Supporting prompts for Part 1 live in `prompts/part1`.

### Part 2 — ChatVault Backend Options

We explore several ways to implement the backend as a separate MCP server:

- Vibe‑coded backend (Node/TypeScript)
- n8n
- Make
- Zapier + Agent Kit

Each path covers how to:

- Integrate with Neon PostgreSQL Vector DB.
- Implement MCP tools.
- Debug and provide test coverage.

### Part 3 — Putting the Widget and the Backend MCP together and adding a SaaS Layer with Findexar

We combine two MCP downstream servers while injecting SaaS functionality into a single MCP-UI (skybridge) server.

We turn the app into a SaaS product using **[Findexar](https://findexar.com)**:

- Learn how to set up the creator org in Findexar, configure Stripe and subscription plans, and wire the connectors.
- Plug into Findexar’s **SaaS‑in‑a‑bottle** capabilities instead of building SaaS infrastructure from scratch.
- Focus on your product and UX while Findexar handles the SaaS backbone (accounts, plans, usage, and related operations).

### Part 4 — Production: GitHub, CI/CD, Vercel

We take everything to production:

- Use GitHub for version control and collaboration.
- Set up a basic CI/CD pipeline.
- Deploy to Vercel.
- Configure environment variables and secrets.
- Add basic logging/error visibility.

---

## Repository structure

This starter repo is intentionally minimal:

```text
prompts/
  part1/
    # Prompt notes & scripts for Part 1 (Cursor / vibe-coding)
```

## How to use this repo

1. **Clone the repo**

   ```bash
   git clone https://github.com/findexar/chatvault-tutorial.git
   cd YOUR_REPO_NAME
   ```

2. **Open in Cursor (or your editor of choice)**

   - Open the repo in Cursor.
   - Navigate to `prompts/part1` while following Part 1 of the series.

3. **Follow the video series**
   - Use the prompts as a guide for vibe coding.
   - Build your own backend(s), Findexar integration, and deployment setup as you progress through Parts 2–4.

---

## License

MIT License

Copyright (c) 2025 Findexar, Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Feedback & contributions

Suggestions, issues, and PRs are welcome.

If you’re following along with the series and get stuck:

- Open an **Issue** on GitHub with context.
- Mention which **part** you’re on and which toolchain you’re using (vibe‑coded backend, n8n, Make, Zapier, Findexar, etc.).

Happy building!
