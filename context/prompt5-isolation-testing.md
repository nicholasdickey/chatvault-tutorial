# Prompt5: Isolated Widget Testing

## Overview

Prompt5 sets up isolated testing of the ChatVault widget outside of the ChatGPT/MCP context. This allows us to:

- Test widget UI/UX independently
- Debug widget-only issues
- Verify graceful handling of missing host APIs
- Exercise UI interactions without MCP dependencies

## Setup

### Start the Widget Server

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1
pnpm run serve:widget
# Or: ./serve-widget.sh
# Or: PORT=4444 ./serve-widget.sh
```

This will:

- Serve the `assets/` directory on port 4444
- Use `npx serve` to create a simple static file server
- Make the widget accessible at `http://localhost:4444/chat-vault.html`

### Prerequisites

- Widget must be built first: `pnpm run build`
- `serve` package will be installed automatically via `npx`

## Testing Checklist

### 1. Widget Loads Successfully

- [ ] Open `http://localhost:4444/chat-vault.html` in browser
- [ ] Widget HTML loads without errors
- [ ] JavaScript executes (check browser console)
- [ ] React mounts successfully (check for "Widget initialized" in debug panel)
- [ ] CSS styles apply correctly

### 2. UI Rendering (Without Skybridge)

- [ ] Header renders with "ChatVault" title
- [ ] Shows "Widget running in isolation mode" message (since no window.openai)
- [ ] Debug panel is visible and collapsible
- [ ] Dark mode detection works (if browser/system in dark mode)

### 3. UI Interactions (Local Only)

- [ ] Debug panel toggle works (expand/collapse)
- [ ] Debug logs are visible and readable
- [ ] Widget remains responsive (no hanging)
- [ ] No infinite retries or unbounded logging

### 4. Graceful Degradation

- [ ] Widget detects missing `window.openai.callTool`
- [ ] Shows appropriate message (not error state)
- [ ] Widget remains functional for UI testing
- [ ] Debug panel shows "Widget is running in isolation mode" log
- [ ] No console errors related to missing APIs

### 5. Dark Mode Support

- [ ] Widget detects system dark mode preference
- [ ] Widget adapts to `data-theme="dark"` attribute (if set)
- [ ] Colors and contrast are appropriate in both modes
- [ ] Theme changes are detected dynamically

## Expected Behavior

### With Embedded Data

If the widget HTML contains embedded chat data (from MCP server):

- Widget should display the chat list
- All UI interactions should work (expand/collapse, copy, etc.)

### Without Embedded Data (Isolation Mode)

- Widget should show "Widget running in isolation mode" message
- Debug panel should show logs indicating missing skybridge
- Widget should NOT show error state
- Widget should remain responsive and testable

## Debug Panel Logs to Check

When running in isolation, you should see:

1. "Widget initialized"
2. "Loading initial chat data"
3. "Failed to parse embedded data" (if no embedded data)
4. "window.openai.callTool not available - using empty state"
5. "Widget is running in isolation mode (no skybridge)"

## Troubleshooting

### Widget doesn't load

- Check browser console for errors
- Verify `pnpm run build` completed successfully
- Check that `assets/chat-vault.html` exists
- Verify server is running on correct port

### React doesn't mount

- Check browser console for React errors
- Verify `chat-vault-root` div exists in HTML
- Check that JavaScript bundle loaded correctly

### Missing styles

- Verify CSS bundle is inlined in HTML
- Check browser DevTools Network tab for failed requests
- Verify Tailwind classes are being processed

### window.openai errors

- These are expected in isolation mode
- Widget should handle gracefully (not crash)
- Check debug panel for appropriate log messages

## Integration with Full MCP Flow

After validating in isolation:

1. Start MCP server: `cd mcp_server && pnpm start`
2. Expose with ngrok: `./start-ngrok.sh`
3. Test in ChatGPT with full MCP integration
4. Compare behavior between isolation and full context

## Notes

- Isolation testing helps identify widget-specific issues
- Full MCP testing validates protocol and transport
- Both are necessary for complete validation
- Debug panel is crucial for diagnosing issues in both contexts
