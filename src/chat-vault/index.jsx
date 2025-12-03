import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

// Chat data structure (no TypeScript types in .jsx file)

// Debug logging
const debugLogs = [];
const addLog = (message, data = null) => {
  const log = {
    timestamp: new Date().toISOString(),
    message,
    data: data ? JSON.stringify(data, null, 2) : null,
  };
  debugLogs.push(log);
  console.log(`[ChatVault] ${message}`, data || "");
  // Keep only last 100 logs
  if (debugLogs.length > 100) {
    debugLogs.shift();
  }
};

function App() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedChat, setSelectedChat] = useState(null);
  const [expandedTurns, setExpandedTurns] = useState(new Set());
  const [copiedItems, setCopiedItems] = useState(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Check for dark mode
  useEffect(() => {
    addLog("Widget initialized");
    
    const checkDarkMode = () => {
      const root = document.documentElement;
      const theme = root.getAttribute("data-theme");
      const hasDarkClass = root.classList.contains("dark");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      
      // Only use dark mode if explicitly set via data-theme or class
      // Don't use system preference by default (widget should default to light)
      const isDark = theme === "dark" || hasDarkClass;
      
      setIsDarkMode(isDark);
      addLog("Dark mode check", { 
        isDark, 
        theme, 
        hasDarkClass, 
        prefersDark,
        note: "Only using explicit theme/class, not system preference"
      });
    };
    
    checkDarkMode();
    
    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    
    // Watch for system theme changes (but don't use it, just log)
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      addLog("System theme changed", { prefersDark: mediaQuery.matches });
      // Don't update isDarkMode based on system preference
    };
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    
    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  // Load initial data from embedded script or call loadChats
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        addLog("Loading initial chat data");
        
        // Try to read embedded data first
        const dataScript = document.getElementById("chatvault-initial-data");
        if (dataScript) {
          try {
            const initialChats = JSON.parse(dataScript.textContent || "[]");
            addLog("Loaded chats from embedded data", { count: initialChats.length });
            setChats(initialChats);
            setLoading(false);
            return;
          } catch (e) {
            addLog("Failed to parse embedded data", { error: e.message });
          }
        }
        
        // Fallback: call loadChats via skybridge
        if (window.openai?.callTool) {
          addLog("Calling loadChats via skybridge");
          try {
            const result = await window.openai.callTool("loadChats", {
              page: 0,
              pageSize: 10,
            });
            addLog("loadChats result", result);
            
            if (result?.structuredContent?.chats) {
              setChats(result.structuredContent.chats);
            } else if (result?.content?.[0]?.text) {
              addLog("Unexpected result format", result);
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            addLog("Error calling loadChats via skybridge", { error: errorMessage });
            setError(`Failed to load chats: ${errorMessage}`);
          }
        } else {
          addLog("window.openai.callTool not available - using empty state");
          addLog("Widget is running in isolation mode (no skybridge)");
          // In isolation mode, show a message but don't set error
          // The widget should still be functional for UI testing
          setChats([]);
        }
        
        setLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        addLog("Error loading chats", { error: errorMessage });
        setError(errorMessage);
        setLoading(false);
      }
    };
    
    loadInitialData();
  }, []);

  const handleChatClick = (chat) => {
    addLog("Chat clicked", { title: chat.title });
    setSelectedChat(chat);
    setExpandedTurns(new Set());
  };

  const handleBackClick = () => {
    addLog("Back clicked");
    setSelectedChat(null);
    setExpandedTurns(new Set());
  };

  const toggleTurnExpansion = (index) => {
    addLog("Toggle turn expansion", { index });
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const copyToClipboard = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      addLog("Copied to clipboard", { id });
      setCopiedItems((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setCopiedItems((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 5000);
    } catch (err) {
      addLog("Failed to copy", { error: err.message });
    }
  };

  const truncateText = (text, maxLength = 150) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className={`antialiased w-full px-4 py-6 border rounded-2xl sm:rounded-3xl overflow-hidden ${
        isDarkMode 
          ? "bg-gray-900 border-gray-700 text-white" 
          : "bg-white border-black/10 text-black"
      }`}>
        <div className="text-center text-sm opacity-60">Loading chats...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`antialiased w-full px-4 py-6 border rounded-2xl sm:rounded-3xl overflow-hidden ${
        isDarkMode 
          ? "bg-gray-900 border-gray-700 text-white" 
          : "bg-white border-black/10 text-black"
      }`}>
        <div className="text-center text-sm text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className={`antialiased w-full text-black px-4 pb-2 border rounded-2xl sm:rounded-3xl overflow-hidden ${
      isDarkMode 
        ? "bg-gray-900 border-gray-700 text-white" 
        : "bg-white border-black/10 text-black"
    }`}>
      <div className="max-w-full">
        {/* Header */}
        <div className={`flex flex-row items-center gap-4 sm:gap-4 border-b py-4 ${
          isDarkMode ? "border-gray-700" : "border-black/5"
        }`}>
          <div className="sm:w-18 w-16 aspect-square rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-white font-bold text-xl">CV</span>
            </div>
          <div className="flex-1">
            <div className="text-base sm:text-xl font-medium">ChatVault</div>
            <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
              {selectedChat ? selectedChat.title : "Your saved conversations"}
            </div>
          </div>
          {selectedChat && (
            <button
              onClick={handleBackClick}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                isDarkMode
                  ? "bg-gray-800 text-white hover:bg-gray-700"
                  : "bg-gray-100 text-black hover:bg-gray-200"
              }`}
            >
              Back
            </button>
          )}
        </div>

        {/* Content */}
        <div className="min-w-full text-sm flex flex-col py-4">
          {selectedChat ? (
            // Chat detail view
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${
                isDarkMode ? "bg-gray-800" : "bg-gray-50"
              }`}>
                <div className="font-medium mb-1">{selectedChat.title}</div>
                <div className={`text-xs ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                  {formatDate(selectedChat.timestamp)}
                </div>
              </div>
              
              {selectedChat.turns.map((turn, index) => {
                const isExpanded = expandedTurns.has(index);
                const promptId = `prompt-${selectedChat.timestamp}-${index}`;
                const responseId = `response-${selectedChat.timestamp}-${index}`;
                const promptCopied = copiedItems.has(promptId);
                const responseCopied = copiedItems.has(responseId);
                
                return (
                  <div key={index} className={`space-y-2 p-4 rounded-lg border ${
                    isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                  }`}>
                    {/* Prompt */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className={`text-xs font-medium ${
                          isDarkMode ? "text-blue-400" : "text-blue-600"
                        }`}>
                          Prompt
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => toggleTurnExpansion(index)}
                            className={`text-xs px-2 py-1 rounded ${
                              isDarkMode
                                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                          >
                            {isExpanded ? "Collapse" : "Expand"}
                          </button>
                          <button
                            onClick={() => copyToClipboard(turn.prompt, promptId)}
                            className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                              promptCopied
                                ? "bg-green-500 text-white"
                                : isDarkMode
                                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                          >
                            {promptCopied ? "✓" : "Copy"}
                          </button>
                        </div>
                    </div>
                      <div className={`text-sm ${
                        isDarkMode ? "text-gray-200" : "text-gray-800"
                      }`}>
                        {isExpanded ? turn.prompt : truncateText(turn.prompt)}
                      </div>
                    </div>
                    
                    {/* Response */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className={`text-xs font-medium ${
                          isDarkMode ? "text-green-400" : "text-green-600"
                        }`}>
                          Response
                        </div>
                        <button
                          onClick={() => copyToClipboard(turn.response, responseId)}
                          className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                            responseCopied
                              ? "bg-green-500 text-white"
                              : isDarkMode
                              ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                        >
                          {responseCopied ? "✓" : "Copy"}
                        </button>
                        </div>
                      <div className={`text-sm ${
                        isDarkMode ? "text-gray-200" : "text-gray-800"
                      }`}>
                        {isExpanded ? turn.response : truncateText(turn.response)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Chat list view
            <div className="space-y-2">
              {chats.length === 0 ? (
                <div className={`py-6 text-center ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                  {window.openai?.callTool ? (
                    "No chats found. Start a conversation to save it here."
                  ) : (
                    <div>
                      <div className="mb-2">Widget running in isolation mode</div>
                      <div className="text-xs opacity-75">
                        window.openai.callTool not available. Check debug panel for details.
                </div>
                </div>
                  )}
                </div>
              ) : (
                chats.map((chat) => (
                  <button
                    key={chat.timestamp}
                    onClick={() => handleChatClick(chat)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      isDarkMode
                        ? "bg-gray-800 border-gray-700 hover:bg-gray-700"
                        : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <div className="font-medium mb-1">{chat.title}</div>
                    <div className={`text-xs ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                      {formatDate(chat.timestamp)} • {chat.turns.length} turn{chat.turns.length !== 1 ? "s" : ""}
              </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Debug Panel */}
        <div className={`mt-4 pt-4 border-t ${
          isDarkMode ? "border-gray-700" : "border-black/5"
        }`}>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`w-full text-left px-2 py-1 rounded text-xs font-medium ${
              isDarkMode
                ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {showDebug ? "▼" : "▶"} Debug Panel ({debugLogs.length} logs)
          </button>
          {showDebug && (
            <div className={`mt-2 p-3 rounded text-xs font-mono max-h-64 overflow-y-auto ${
              isDarkMode ? "bg-gray-950 text-gray-300" : "bg-gray-50 text-gray-800"
            }`}>
              {debugLogs.length === 0 ? (
                <div className="opacity-60">No logs yet</div>
              ) : (
                debugLogs.map((log, idx) => (
                  <div key={idx} className="mb-2 border-b border-gray-700 pb-2">
                    <div className="opacity-60 text-xs">{log.timestamp}</div>
                    <div className="mt-1">{log.message}</div>
                    {log.data && (
                      <pre className="mt-1 text-xs opacity-80 whitespace-pre-wrap break-words">
                        {log.data}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("chat-vault-root")).render(<App />);
