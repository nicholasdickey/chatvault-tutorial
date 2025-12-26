import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MdArrowBack, MdExpandMore, MdExpandLess, MdContentCopy, MdAdd, MdClose, MdCheck, MdSearch, MdRefresh, MdAccountCircle, MdDelete } from "react-icons/md";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pagination, setPagination] = useState(null);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [paginationLoading, setPaginationLoading] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState(new Set());
  const [copiedItems, setCopiedItems] = useState({});
  // Debug panel hidden by default, can be toggled with Ctrl+Shift+D
  const [showDebug, setShowDebug] = useState(() => {
    // Check localStorage for previously enabled debug panel
    return localStorage.getItem("chatvault-debug-enabled") === "true";
  });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showManualSaveModal, setShowManualSaveModal] = useState(false);
  const [manualSaveTitle, setManualSaveTitle] = useState("");
  const [manualSaveContent, setManualSaveContent] = useState("");
  const [manualSaveError, setManualSaveError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userInfo, setUserInfo] = useState(null);

  // Keyboard shortcut to toggle debug panel (Ctrl+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Shift+D (or Cmd+Shift+D on Mac)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        const newState = !showDebug;
        setShowDebug(newState);
        // Persist in localStorage
        if (newState) {
          localStorage.setItem("chatvault-debug-enabled", "true");
        } else {
          localStorage.removeItem("chatvault-debug-enabled");
        }
        addLog("Debug panel toggled", { enabled: newState });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showDebug]);

  // Check for dark mode
  useEffect(() => {
    addLog("Widget initialized", { debugEnabled: showDebug });
    
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

  // Load initial data from embedded script or call loadMyChats
  // Only run once on mount
  const hasLoadedInitial = useRef(false);
  useEffect(() => {
    // Skip if we've already loaded initial data
    if (hasLoadedInitial.current) {
      return;
    }

    const loadInitialData = async () => {
      hasLoadedInitial.current = true;
      try {
        addLog("Loading initial chat data");
        
        // Try to read embedded data first
        const dataScript = document.getElementById("chatvault-initial-data");
        if (dataScript) {
          try {
            const initialChats = JSON.parse(dataScript.textContent || "[]");
            addLog("Loaded chats from embedded data", { count: initialChats.length });
            setChats(deduplicateChats(initialChats));
            setLoading(false);
            return;
          } catch (e) {
            addLog("Failed to parse embedded data", { error: e.message });
          }
        }
        
        // Fallback: call loadMyChats via skybridge
        if (window.openai?.callTool) {
          addLog("Calling loadMyChats via skybridge");
          try {
            const result = await window.openai.callTool("loadMyChats", {
              page: 0,
              size: 10,
            });
            addLog("loadMyChats result", result);
            
            if (result?.structuredContent?.chats) {
              setChats(deduplicateChats(result.structuredContent.chats));
              setPagination(result.structuredContent.pagination);
              setCurrentPage(0);
              setPageInputValue("1");
              // Extract userInfo if present
              if (result.structuredContent.userInfo) {
                setUserInfo(result.structuredContent.userInfo);
                addLog("User info extracted", result.structuredContent.userInfo);
              }
            } else if (result?.content?.[0]?.text) {
              addLog("Unexpected result format", result);
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            addLog("Error calling loadMyChats via skybridge", { error: errorMessage });
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

  // Deduplicate chats based on title and content
  // Keeps the most recent chat (by timestamp) when duplicates are found
  const deduplicateChats = (chatList) => {
    const seen = new Map();
    const deduplicated = [];
    
    for (const chat of chatList) {
      // Create a signature based on title and first turn content
      const firstTurn = chat.turns?.[0];
      const signature = `${chat.title || ""}|${firstTurn?.prompt || ""}|${firstTurn?.response || ""}`;
      
      if (!seen.has(signature)) {
        seen.set(signature, chat);
        deduplicated.push(chat);
      } else {
        // If we've seen this before, keep the one with the latest timestamp
        const existing = seen.get(signature);
        const existingTime = new Date(existing.timestamp).getTime();
        const currentTime = new Date(chat.timestamp).getTime();
        
        if (currentTime > existingTime) {
          // Replace the existing one with the newer one
          const index = deduplicated.indexOf(existing);
          if (index !== -1) {
            deduplicated[index] = chat;
            seen.set(signature, chat);
          }
        }
      }
    }
    
    return deduplicated;
  };

  const handleChatClick = (chat) => {
    addLog("Chat clicked", { title: chat.title });
    setSelectedChat(chat);
    setExpandedTurns(new Set());
    // Search state persists - don't clear it
  };

  const handleBackClick = () => {
    addLog("Back clicked");
    setSelectedChat(null);
    setExpandedTurns(new Set());
  };

  const handleRefresh = async () => {
    addLog("Refresh clicked");
    setLoading(true);
    setError(null);
    try {
      if (window.openai?.callTool) {
        const result = await window.openai.callTool("loadMyChats", {
          page: 0,
          size: 10,
        });
        if (result?.structuredContent?.chats) {
          setChats(deduplicateChats(result.structuredContent.chats));
          setPagination(result.structuredContent.pagination);
          setCurrentPage(0);
          setPageInputValue("1");
          if (result.structuredContent.userInfo) {
            setUserInfo(result.structuredContent.userInfo);
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Error refreshing chats", { error: errorMessage });
      setError(`Failed to refresh: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMyAccountClick = () => {
    if (userInfo?.portalLink) {
      addLog("My Account clicked", { portalLink: userInfo.portalLink });
      window.open(userInfo.portalLink, "_blank");
    } else {
      addLog("My Account clicked but no portal link available");
    }
  };

  const handleCounterClick = () => {
    if (userInfo?.isAnon) {
      const message = `The free version is limited to ${userInfo.totalChats || 10} chats. Upgrade your account to save unlimited chats.`;
      alert(message);
      addLog("Counter clicked", { message });
    }
  };

  const handleDeleteChat = async (chat) => {
    addLog("Delete chat clicked", { chatId: chat.id, title: chat.title });
    
    // Show confirmation dialog
    const confirmed = window.confirm(`Are you sure you want to delete "${chat.title}"?`);
    if (!confirmed) {
      addLog("Delete cancelled by user");
      return;
    }

    try {
      if (!window.openai?.callTool) {
        throw new Error("deleteChat tool not available");
      }

      // Get userId from chat object or first chat in list
      const userId = chat.userId || (chats.length > 0 && chats[0].userId) || "";
      if (!userId) {
        throw new Error("User ID not available. Please refresh and try again.");
      }

      addLog("Calling deleteChat tool", { chatId: chat.id, userId });
      const result = await window.openai.callTool("deleteChat", {
        chatId: chat.id,
        userId: userId,
      });

      addLog("Delete chat result", result);

      if (result?.structuredContent?.deleted) {
        // Remove from local state immediately
        setChats((prev) => prev.filter((c) => c.id !== chat.id));
        addLog("Chat removed from local state");

        // Refresh the list to update counts
        await handleRefresh();
      } else {
        throw new Error(result?.structuredContent?.message || "Delete failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Error deleting chat", { error: errorMessage });
      alert(`Failed to delete chat: ${errorMessage}`);
    }
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
    console.log("[copyToClipboard] Called", { id, textLength: text?.length });
    
    const setCopiedState = () => {
      setCopiedItems((prev) => {
        const next = {
          ...prev,
          [id]: true,
        };
        console.log("[copyToClipboard] Setting copiedItems", { id, prev, next });
        return next;
      });
      setTimeout(() => {
        console.log("[copyToClipboard] Removing copied state after timeout", { id });
        setCopiedItems((prev) => {
          const next = { ...prev };
          delete next[id];
          console.log("[copyToClipboard] Removed from copiedItems", { id, next });
          return next;
        });
      }, 3000);
    };

    // Use execCommand (works in iframes)
    try {
      // Store current scroll position
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      
      // Create a temporary textarea element
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-999999px";
      textarea.style.top = "-999999px";
      textarea.style.opacity = "0";
      textarea.setAttribute("readonly", "");
      document.body.appendChild(textarea);
      
      // Select text without focusing (to avoid scroll)
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      
      // Restore scroll position
      window.scrollTo(scrollX, scrollY);
      
      if (successful) {
        console.log("[copyToClipboard] Copy successful", { id });
        addLog("Copied to clipboard", { id });
        setCopiedState();
      } else {
        throw new Error("execCommand('copy') returned false");
      }
    } catch (err) {
      console.error("[copyToClipboard] Copy failed", { id, error: err.message, err });
      addLog("Failed to copy - clipboard access blocked. Please copy manually.", { 
        error: err.message,
        suggestion: "The clipboard API is blocked in this context. You may need to copy the text manually."
      });
      
      // Show a user-friendly message
      alert("Unable to copy to clipboard automatically. The text has been logged to the debug panel. Please copy it manually.");
    }
  };

  const formatChatForCopy = (chat) => {
    if (!chat || !chat.turns || chat.turns.length === 0) {
      return "";
    }
    
    return chat.turns
      .map((turn) => {
        return `You said:\n${turn.prompt}\n\nChatGPT said:\n${turn.response}`;
      })
      .join("\n\n");
  };

  const copyEntireChat = async (chat) => {
    console.log("[copyEntireChat] Called", { chat, timestamp: chat?.timestamp });
    try {
      if (!chat || !chat.timestamp) {
        throw new Error("Invalid chat object");
      }
      const chatId = `chat-${chat.timestamp}`;
      console.log("[copyEntireChat] Formatting chat", { chatId, turnsCount: chat.turns?.length });
      const formattedText = formatChatForCopy(chat);
      console.log("[copyEntireChat] Formatted text length", { chatId, textLength: formattedText.length });
      await copyToClipboard(formattedText, chatId);
      console.log("[copyEntireChat] Success", { chatId });
    } catch (err) {
      console.error("[copyEntireChat] Error", { error: err.message, err, chat });
      addLog("Failed to copy entire chat", { error: err.message });
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

  const handleManualSave = async () => {
    if (!manualSaveContent.trim()) {
      setManualSaveError("Please paste the ChatGPT conversation");
      return;
    }

    setIsSaving(true);
    setManualSaveError(null);
    addLog("Starting manual save", { hasTitle: !!manualSaveTitle, contentLength: manualSaveContent.length });

    try {
      if (!window.openai?.callTool) {
        throw new Error("saveChatManually tool not available");
      }

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Request timed out after 30 seconds")), 30000);
      });

      const callToolPromise = window.openai.callTool("saveChatManually", {
        htmlContent: manualSaveContent,
        title: manualSaveTitle.trim() || undefined,
      });

      const result = await Promise.race([callToolPromise, timeoutPromise]);
      
      addLog("Manual save result received", { 
        result, 
        resultType: typeof result, 
        isNull: result === null,
        isUndefined: result === undefined,
        hasError: !!result?.error,
        keys: result ? Object.keys(result) : [],
        stringified: JSON.stringify(result).substring(0, 500)
      });

      // If result is null/undefined, that's an error
      if (result == null) {
        throw new Error("No response received from server");
      }

      // Check for errors in the response (multiple possible formats)
      if (result?.error) {
        const errorMessage = result.error.message || result.error?.data || result.error || "Unknown error occurred";
        addLog("Error found in result.error", result.error);
        throw new Error(errorMessage);
      }

      // Check for JSON-RPC error format
      if (result?.jsonrpc === "2.0" && result?.error) {
        const errorMessage = result.error.message || result.error.data || "Unknown error occurred";
        addLog("JSON-RPC error found", result.error);
        throw new Error(errorMessage);
      }

      // Check if content indicates an error
      if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
        const firstContent = result.content[0];
        if (firstContent?.text) {
          const text = firstContent.text;
          addLog("Content text found", { text: text.substring(0, 200) });
          if (text.toLowerCase().includes("error") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("could not parse")) {
            addLog("Error text found in content", text);
            throw new Error(text);
          }
        }
      }

      // Check structuredContent for error indicators
      if (result?.structuredContent) {
        // Check for limit_reached error specifically
        if (result.structuredContent.error === "limit_reached") {
          const message = result.structuredContent.message || "Chat limit reached";
          const portalLink = result.structuredContent.portalLink;
          addLog("Limit reached error", { message, portalLink });
          
          // Show error message with portal link option
          let errorMessage = message;
          if (portalLink) {
            const openPortal = window.confirm(`${message}\n\nWould you like to upgrade your account?`);
            if (openPortal) {
              window.open(portalLink, "_blank");
            }
          }
          setManualSaveError(message);
          return; // Don't throw, just show error in modal
        }
        
        if (result.structuredContent.error) {
          const errorMessage = result.structuredContent.error.message || result.structuredContent.error || "Unknown error occurred";
          addLog("Error found in structuredContent", result.structuredContent.error);
          throw new Error(errorMessage);
        }
        // Also check if structuredContent has an error-like structure
        if (result.structuredContent.saved === false || result.structuredContent.success === false) {
          const errorMessage = result.structuredContent.message || result.structuredContent.error || "Save operation failed";
          addLog("Save failed indicated in structuredContent", result.structuredContent);
          throw new Error(errorMessage);
        }
      }
      
      addLog("Manual save successful", result);
      
      // Close modal and reset form on success
      setShowManualSaveModal(false);
      setManualSaveTitle("");
      setManualSaveContent("");
      setManualSaveError(null);

      // Reload chats and update userInfo
      if (window.openai?.callTool) {
        try {
          const loadResult = await window.openai.callTool("loadMyChats", {
            page: 0,
            size: 10,
          });
          if (loadResult?.structuredContent?.chats) {
            setChats(deduplicateChats(loadResult.structuredContent.chats));
            setPagination(loadResult.structuredContent.pagination);
            setCurrentPage(0);
            setPageInputValue("1");
            // Update userInfo to refresh counter
            if (loadResult.structuredContent.userInfo) {
              setUserInfo(loadResult.structuredContent.userInfo);
              addLog("UserInfo updated after save", loadResult.structuredContent.userInfo);
            }
          }
        } catch (err) {
          addLog("Error reloading chats after manual save", { error: err.message });
        }
      }
    } catch (err) {
      let errorMessage = "Unknown error occurred";
      
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "string") {
        errorMessage = err;
      } else if (err && typeof err === "object") {
        // Try to extract error message from various possible structures
        errorMessage = err.message || err.error?.message || err.error || JSON.stringify(err);
      }
      
      addLog("Manual save failed", { error: errorMessage, err, errType: typeof err, errString: String(err) });
      setManualSaveError(errorMessage || "Failed to save chat. Please check the debug panel for details.");
    } finally {
      setIsSaving(false);
      addLog("Manual save handler finished", { isSaving: false });
    }
  };

  const handleCloseManualSaveModal = () => {
    setShowManualSaveModal(false);
    setManualSaveTitle("");
    setManualSaveContent("");
    setManualSaveError(null);
  };

  const handleSearch = async (query, page = 0) => {
    if (!query.trim()) {
      // Clear search - reload regular chats
      handleClearSearch();
      return;
    }

    setIsSearching(true);
    setSearchLoading(true);
    setCurrentPage(page);
    addLog("Searching chats", { query, page });

    try {
      if (!window.openai?.callTool) {
        throw new Error("loadMyChats tool not available");
      }

      // Use loadMyChats with query parameter (free, no credits)
      const result = await window.openai.callTool("loadMyChats", {
        query: query.trim(),
        page,
        size: 10,
      });

      addLog("Search result", result);

      if (result?.structuredContent?.chats) {
        // Always replace results when navigating pages
        setChats(deduplicateChats(result.structuredContent.chats));
        setPagination(result.structuredContent.pagination);
        setCurrentPage(page);
        setPageInputValue(String(page + 1));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Search failed", { error: errorMessage });
      setError(`Search failed: ${errorMessage}`);
    } finally {
      setSearchLoading(false);
      // Keep isSearching true - it indicates search is active
    }
  };

  const handleClearSearch = async () => {
    setSearchQuery("");
    setIsSearching(false);
    setCurrentPage(0);
    setPaginationLoading(true);
    addLog("Clearing search, reloading chats");

    try {
      if (window.openai?.callTool) {
        const result = await window.openai.callTool("loadMyChats", {
          page: 0,
          size: 10,
        });
        if (result?.structuredContent?.chats) {
          setChats(deduplicateChats(result.structuredContent.chats));
          setPagination(result.structuredContent.pagination);
          setCurrentPage(0);
          setPageInputValue("1");
        }
      }
    } catch (err) {
      addLog("Error reloading chats", { error: err.message });
    } finally {
      setPaginationLoading(false);
    }
  };

  const loadMoreChats = async () => {
    if (!pagination?.hasMore || loading) return;

    const nextPage = currentPage + 1;
    setLoading(true);
    addLog("Loading more chats", { page: nextPage, isSearching });

    try {
      if (!window.openai?.callTool) return;

      if (isSearching && searchQuery) {
        // Load more search results using loadMyChats with query (free)
        const result = await window.openai.callTool("loadMyChats", {
          query: searchQuery.trim(),
          page: nextPage,
          size: 10,
        });
        if (result?.structuredContent?.chats) {
          setChats((prev) => deduplicateChats([...prev, ...result.structuredContent.chats]));
          setPagination(result.structuredContent.pagination);
          setCurrentPage(nextPage);
          setPageInputValue(String(nextPage + 1));
        }
      } else {
        // Load more regular chats
        const result = await window.openai.callTool("loadMyChats", {
          page: nextPage,
          size: 10,
        });
        if (result?.structuredContent?.chats) {
          setChats((prev) => deduplicateChats([...prev, ...result.structuredContent.chats]));
          setPagination(result.structuredContent.pagination);
          setCurrentPage(nextPage);
          setPageInputValue(String(nextPage + 1));
        }
      }
    } catch (err) {
      addLog("Error loading more chats", { error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Handle Esc key to clear search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && searchQuery && !selectedChat) {
        e.preventDefault();
        handleClearSearch();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [searchQuery, selectedChat]);

  // SVG logo component
  const ChatVaultLogo = () => (
    <svg width="64" height="64" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="1024" height="1024" rx="220" fill="#0F172A"/>
      <circle cx="512" cy="512" r="300" fill="none" stroke="#E5E7EB" strokeWidth="80"/>
      <rect x="492" y="212" width="40" height="120" rx="20" fill="#E5E7EB"/>
      <rect x="492" y="692" width="40" height="120" rx="20" fill="#E5E7EB"/>
      <rect x="212" y="492" width="120" height="40" rx="20" fill="#E5E7EB"/>
      <rect x="692" y="492" width="120" height="40" rx="20" fill="#E5E7EB"/>
      <circle cx="512" cy="512" r="40" fill="#E5E7EB"/>
      <rect x="590" y="350" width="220" height="140" rx="40" fill="#3B82F6"/>
      <path d="M650 490 L620 560 L700 500 Z" fill="#3B82F6"/>
      <rect x="630" y="385" width="140" height="16" rx="8" fill="#E5E7EB"/>
      <rect x="630" y="420" width="100" height="16" rx="8" fill="#E5E7EB"/>
    </svg>
  );

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
        {/* Toolbar */}
        <div className={`flex flex-row items-center justify-between gap-2 py-3 border-b ${
          isDarkMode ? "border-gray-700" : "border-black/5"
        }`}>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-lg transition-colors ${
                isDarkMode 
                  ? "hover:bg-gray-800 text-gray-300" 
                  : "hover:bg-gray-100 text-gray-600"
              }`}
              title="Refresh chats"
            >
              <MdRefresh className="w-5 h-5" />
            </button>
            <button
              onClick={handleMyAccountClick}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                isDarkMode 
                  ? "hover:bg-gray-800 text-gray-300" 
                  : "hover:bg-gray-100 text-gray-700"
              }`}
              title="My Account"
            >
              <MdAccountCircle className="w-5 h-5" />
              <span>My Account</span>
            </button>
          </div>
          {userInfo?.isAnon && userInfo.remainingSlots !== undefined && (
            <button
              onClick={handleCounterClick}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                userInfo.remainingSlots === 0
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : userInfo.remainingSlots === 1
                  ? "bg-yellow-500 text-white hover:bg-yellow-600"
                  : "bg-green-500 text-white hover:bg-green-600"
              }`}
              title="Click to learn about chat limits"
            >
              {userInfo.remainingSlots}/{userInfo.totalChats !== undefined && userInfo.remainingSlots !== undefined 
                ? userInfo.totalChats + userInfo.remainingSlots 
                : 10} chats
            </button>
          )}
        </div>
        {/* Header */}
        <div className={`flex flex-row items-center gap-4 sm:gap-4 border-b py-4 ${
          isDarkMode ? "border-gray-700" : "border-black/5"
        }`}>
          <div 
            className={`sm:w-18 w-16 aspect-square rounded-xl flex items-center justify-center overflow-hidden ${
              selectedChat ? "cursor-pointer hover:opacity-80" : ""
            }`}
            onClick={selectedChat ? handleBackClick : undefined}
            title={selectedChat ? "Back to conversations" : undefined}
          >
            <ChatVaultLogo />
          </div>
          <div className="flex-1">
            <div 
              className={`text-base sm:text-xl font-medium ${
                selectedChat ? "cursor-pointer hover:opacity-80" : ""
              }`}
              onClick={selectedChat ? handleBackClick : undefined}
              title={selectedChat ? "Back to conversations" : undefined}
            >
              ChatVault
            </div>
            <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
              {selectedChat ? selectedChat.title : "Your saved conversations"}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Check if limit reached for anonymous users
                if (userInfo?.isAnon && userInfo.remainingSlots === 0) {
                  const message = userInfo.portalLink
                    ? `You've reached the limit of ${userInfo.totalChats + userInfo.remainingSlots} free chats. Delete a chat to add more, or upgrade your account to save unlimited chats.`
                    : `You've reached the limit of ${userInfo.totalChats + userInfo.remainingSlots} free chats. Please delete a chat to add more.`;
                  alert(message);
                  if (userInfo.portalLink) {
                    const openPortal = window.confirm("Would you like to upgrade your account?");
                    if (openPortal) {
                      window.open(userInfo.portalLink, "_blank");
                    }
                  }
                  return;
                }
                setShowManualSaveModal(true);
              }}
              disabled={paginationLoading || searchLoading}
              className={`p-2 rounded-lg ${
                paginationLoading || searchLoading
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              } ${
                userInfo?.isAnon && userInfo.remainingSlots === 0
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : isDarkMode
                  ? "bg-gray-800 text-white hover:bg-gray-700"
                  : "bg-gray-100 text-black hover:bg-gray-200"
              }`}
              title={userInfo?.isAnon && userInfo.remainingSlots === 0 
                ? "Chat limit reached - delete a chat or upgrade" 
                : "Save chat manually"}
            >
              <MdAdd className="w-5 h-5" />
            </button>
            {selectedChat && (
              <button
                onClick={handleBackClick}
                className={`p-2 rounded-lg ${
                  isDarkMode
                    ? "bg-gray-800 text-white hover:bg-gray-700"
                    : "bg-gray-100 text-black hover:bg-gray-200"
                }`}
                title="Back"
              >
                <MdArrowBack className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Search Box - Only show when not viewing a chat */}
        {!selectedChat && (
          <div className={`border-b py-3 ${isDarkMode ? "border-gray-700" : "border-black/5"}`}>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchQuery}
                  disabled={paginationLoading || searchLoading}
                  onChange={(e) => {
                    if (paginationLoading || searchLoading) return;
                    setSearchQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (paginationLoading || searchLoading) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (searchQuery.trim()) {
                        handleSearch(searchQuery, 0);
                      }
                    }
                  }}
                  placeholder="Search conversations..."
                  className={`w-full px-3 py-2 pl-10 pr-10 rounded-lg border text-sm ${
                    paginationLoading || searchLoading
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  } ${
                    isDarkMode
                      ? "bg-gray-800 border-gray-600 text-white placeholder-gray-400"
                      : "bg-white border-gray-300 text-black placeholder-gray-500"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
                {isSearching ? (
                  <button
                    onClick={handleClearSearch}
                    disabled={paginationLoading || searchLoading}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${
                      paginationLoading || searchLoading
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    } ${
                      isDarkMode
                        ? "text-gray-400 hover:text-gray-300 hover:bg-gray-700"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                    }`}
                    title="Clear search (Esc)"
                  >
                    <MdClose className="w-4 h-4" />
                  </button>
                ) : (
                  <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                    isDarkMode ? "text-gray-400" : "text-gray-500"
                  }`}>
                    <MdSearch className="w-4 h-4" />
                  </div>
                )}
              </div>
              <button
                onClick={async () => {
                  if (paginationLoading || searchLoading) return;
                  if (isSearching) {
                    // Clear search if already searching
                    await handleClearSearch();
                  } else if (searchQuery.trim() && !searchLoading) {
                    // Perform search
                    await handleSearch(searchQuery, 0);
                  }
                }}
                disabled={(!searchQuery.trim() && !isSearching) || searchLoading || paginationLoading}
                className={`p-2 rounded-lg ${
                  ((!searchQuery.trim() && !isSearching) || searchLoading || paginationLoading)
                    ? "opacity-50 cursor-not-allowed"
                    : isDarkMode
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
                title={isSearching ? "Clear search" : "Search"}
              >
                {isSearching ? (
                  <MdClose className="w-5 h-5" />
                ) : (
                  <MdSearch className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="min-w-full text-sm flex flex-col py-4">
          {selectedChat ? (
            // Chat detail view
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${
                isDarkMode ? "bg-gray-800" : "bg-gray-50"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-medium mb-1">{selectedChat.title}</div>
                    <div className={`text-xs ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                      {formatDate(selectedChat.timestamp)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyEntireChat(selectedChat);
                    }}
                    className={`p-1.5 rounded flex items-center flex-shrink-0 ${
                      isDarkMode
                        ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                    title="Copy entire chat"
                  >
                    {copiedItems[`chat-${selectedChat.timestamp}`] ? (
                      <MdCheck className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <MdContentCopy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              
              {selectedChat.turns.map((turn, index) => {
                const isExpanded = expandedTurns.has(index);
                const promptId = `prompt-${selectedChat.timestamp}-${index}`;
                const responseId = `response-${selectedChat.timestamp}-${index}`;
                const promptCopied = !!copiedItems[promptId];
                const responseCopied = !!copiedItems[responseId];
                
                // Check if either prompt or response needs truncation (longer than 150 chars)
                const maxLength = 150;
                const promptNeedsTruncation = turn.prompt.length > maxLength;
                const responseNeedsTruncation = turn.response.length > maxLength;
                const needsExpansion = promptNeedsTruncation || responseNeedsTruncation;
                
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
                        {needsExpansion && (
                          <button
                            onClick={() => toggleTurnExpansion(index)}
                            className={`p-1.5 rounded ${
                              isDarkMode
                                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                            title={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <MdExpandLess className="w-4 h-4" />
                            ) : (
                              <MdExpandMore className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                      <div className={`text-sm flex items-start justify-between gap-2 ${
                        isDarkMode ? "text-gray-200" : "text-gray-800"
                      }`}>
                        <span 
                          className={`flex-1 ${needsExpansion && !isExpanded ? "cursor-pointer hover:opacity-80" : ""}`}
                          onClick={needsExpansion && !isExpanded ? () => toggleTurnExpansion(index) : undefined}
                          onMouseDown={(e) => {
                            // If expanded, allow text selection by not preventing default
                            if (isExpanded) {
                              return; // Allow normal text selection
                            }
                            // If not expanded and clickable, prevent text selection on click
                            if (needsExpansion) {
                              e.preventDefault();
                            }
                          }}
                        >
                          {isExpanded ? turn.prompt : truncateText(turn.prompt)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            copyToClipboard(turn.prompt, promptId);
                          }}
                          className={`p-1 rounded flex items-center flex-shrink-0 ${
                            isDarkMode
                              ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                          title="Copy prompt"
                        >
                          {promptCopied ? (
                            <MdCheck className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <MdContentCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
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
                      </div>
                      <div className={`text-sm flex items-start justify-between gap-2 ${
                        isDarkMode ? "text-gray-200" : "text-gray-800"
                      }`}>
                        <span 
                          className={`flex-1 ${needsExpansion && !isExpanded ? "cursor-pointer hover:opacity-80" : ""}`}
                          onClick={needsExpansion && !isExpanded ? () => toggleTurnExpansion(index) : undefined}
                          onMouseDown={(e) => {
                            // If expanded, allow text selection by not preventing default
                            if (isExpanded) {
                              return; // Allow normal text selection
                            }
                            // If not expanded and clickable, prevent text selection on click
                            if (needsExpansion) {
                              e.preventDefault();
                            }
                          }}
                        >
                          {isExpanded ? turn.response : truncateText(turn.response)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            copyToClipboard(turn.response, responseId);
                          }}
                          className={`p-1 rounded flex items-center flex-shrink-0 ${
                            isDarkMode
                              ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                          title="Copy response"
                        >
                          {responseCopied ? (
                            <MdCheck className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <MdContentCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Chat list view
            <div className="space-y-2 relative">
              {loading && chats.length === 0 ? (
                <div className={`py-6 text-center ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                  Loading chats...
                </div>
              ) : searchLoading && chats.length === 0 ? (
                <div className={`py-6 text-center ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                  Searching...
                </div>
              ) : chats.length === 0 ? (
                <div className={`py-6 text-center ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                  {isSearching ? (
                    `No chats found matching "${searchQuery}"`
                  ) : window.openai?.callTool ? (
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
                <>
                  <div className="relative">
                    {chats.map((chat) => (
                      <div
                        key={chat.timestamp || chat.id}
                        className={`w-full flex items-center gap-2 p-4 rounded-lg border transition-colors ${
                          isDarkMode
                            ? "bg-gray-800 border-gray-700"
                            : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <button
                          onClick={() => handleChatClick(chat)}
                          className="flex-1 text-left"
                        >
                          <div className="font-medium mb-1">{chat.title}</div>
                          <div className={`text-xs ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                            {formatDate(chat.timestamp)} • {chat.turns.length} turn{chat.turns.length !== 1 ? "s" : ""}
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteChat(chat);
                          }}
                          className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                            isDarkMode
                              ? "text-gray-400 hover:text-red-400 hover:bg-gray-700"
                              : "text-gray-500 hover:text-red-600 hover:bg-gray-200"
                          }`}
                          title="Delete chat"
                        >
                          <MdDelete className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                    {/* Loading overlay for pagination/search */}
                    {(paginationLoading || (searchLoading && chats.length > 0)) && (
                      <div className={`absolute inset-0 bg-black/30 backdrop-blur-sm rounded-lg flex items-center justify-center z-10 ${
                        isDarkMode ? "bg-black/50" : "bg-white/70"
                      }`}>
                        <div className={`px-4 py-2 rounded-lg font-medium ${
                          isDarkMode ? "bg-gray-800 text-white" : "bg-white text-black shadow-lg"
                        }`}>
                          Loading...
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Pagination */}
                  {pagination && pagination.totalPages > 1 && (
                    <div className="pt-4 flex items-center justify-between gap-2">
                      <button
                        onClick={async () => {
                          if (currentPage > 0 && !paginationLoading && !searchLoading) {
                            const targetPage = currentPage - 1;
                            if (isSearching && searchQuery) {
                              await handleSearch(searchQuery, targetPage);
                            } else {
                              setPaginationLoading(true);
                              try {
                                const res = await window.openai?.callTool("loadMyChats", {
                                  page: targetPage,
                                  size: 10,
                                });
                                if (res?.structuredContent?.chats) {
                                  setChats(deduplicateChats(res.structuredContent.chats));
                                  setPagination(res.structuredContent.pagination);
                                  setCurrentPage(targetPage);
                                  setPageInputValue(String(targetPage + 1));
                                }
                              } catch (err) {
                                addLog("Error loading previous page", { error: err.message });
                              } finally {
                                setPaginationLoading(false);
                              }
                            }
                          }
                        }}
                        disabled={paginationLoading || searchLoading || currentPage === 0}
                        className={`px-3 py-1.5 rounded text-sm font-medium ${
                          paginationLoading || currentPage === 0
                            ? "opacity-50 cursor-not-allowed"
                            : isDarkMode
                            ? "bg-gray-800 text-white hover:bg-gray-700"
                            : "bg-gray-100 text-black hover:bg-gray-200"
                        }`}
                      >
                        Previous
                      </button>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
                          Page
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={pageInputValue}
                          disabled={paginationLoading || searchLoading}
                          onChange={(e) => {
                            if (paginationLoading || searchLoading) return;
                            const value = e.target.value;
                            // Only allow numbers
                            if (value === "" || /^\d+$/.test(value)) {
                              setPageInputValue(value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (paginationLoading || searchLoading) return;
                            if (e.key === "Enter") {
                              const page = parseInt(pageInputValue) - 1;
                              if (page >= 0 && page < pagination.totalPages && page !== currentPage && !paginationLoading && !searchLoading) {
                                if (isSearching && searchQuery) {
                                  handleSearch(searchQuery, page);
                                } else {
                                  setPaginationLoading(true);
                                  window.openai?.callTool("loadMyChats", {
                                    page,
                                    size: 10,
                                  }).then((res) => {
                                    if (res?.structuredContent?.chats) {
                                      setChats(deduplicateChats(res.structuredContent.chats));
                                      setPagination(res.structuredContent.pagination);
                                      setCurrentPage(page);
                                      setPageInputValue(String(page + 1));
                                    }
                                  }).catch((err) => {
                                    addLog("Error loading page", { error: err.message });
                                  }).finally(() => {
                                    setPaginationLoading(false);
                                  });
                                }
                              } else {
                                // Reset to current page if invalid
                                setPageInputValue(String(currentPage + 1));
                              }
                            }
                          }}
                          className={`w-12 px-1.5 py-1 text-center text-sm rounded border ${
                            paginationLoading || searchLoading
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          } ${
                            isDarkMode
                              ? "bg-gray-800 border-gray-600 text-white"
                              : "bg-white border-gray-300 text-black"
                          }`}
                          style={{ WebkitAppearance: "none", MozAppearance: "textfield" }}
                        />
                        <span className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
                          of {pagination.totalPages}
                        </span>
                        {pageInputValue !== String(currentPage + 1) && parseInt(pageInputValue) >= 1 && parseInt(pageInputValue) <= pagination.totalPages && (
                          <button
                            onClick={async () => {
                              const page = parseInt(pageInputValue) - 1;
                              if (page >= 0 && page < pagination.totalPages && page !== currentPage && !paginationLoading && !searchLoading) {
                                if (isSearching && searchQuery) {
                                  await handleSearch(searchQuery, page);
                                } else {
                                  setPaginationLoading(true);
                                  try {
                                    const res = await window.openai?.callTool("loadMyChats", {
                                      page,
                                      size: 10,
                                    });
                                    if (res?.structuredContent?.chats) {
                                      setChats(deduplicateChats(res.structuredContent.chats));
                                      setPagination(res.structuredContent.pagination);
                                      setCurrentPage(page);
                                      setPageInputValue(String(page + 1));
                                    }
                                  } catch (err) {
                                    addLog("Error loading page", { error: err.message });
                                  } finally {
                                    setPaginationLoading(false);
                                  }
                                }
                              }
                            }}
                            disabled={paginationLoading || searchLoading}
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              paginationLoading || searchLoading
                                ? "opacity-50 cursor-not-allowed"
                                : isDarkMode
                                ? "bg-gray-700 text-white hover:bg-gray-600"
                                : "bg-gray-200 text-black hover:bg-gray-300"
                            }`}
                          >
                            Go
                          </button>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          if (pagination.hasMore && !paginationLoading && !searchLoading) {
                            const targetPage = currentPage + 1;
                            if (isSearching && searchQuery) {
                              await handleSearch(searchQuery, targetPage);
                            } else {
                              setPaginationLoading(true);
                              try {
                                const res = await window.openai?.callTool("loadMyChats", {
                                  page: targetPage,
                                  size: 10,
                                });
                                if (res?.structuredContent?.chats) {
                                  setChats(deduplicateChats(res.structuredContent.chats));
                                  setPagination(res.structuredContent.pagination);
                                  setCurrentPage(targetPage);
                                  setPageInputValue(String(targetPage + 1));
                                }
                              } catch (err) {
                                addLog("Error loading next page", { error: err.message });
                              } finally {
                                setPaginationLoading(false);
                              }
                            }
                          }
                        }}
                        disabled={paginationLoading || searchLoading || !pagination.hasMore}
                        className={`px-3 py-1.5 rounded text-sm font-medium ${
                          paginationLoading || searchLoading || !pagination.hasMore
                            ? "opacity-50 cursor-not-allowed"
                            : isDarkMode
                            ? "bg-gray-800 text-white hover:bg-gray-700"
                            : "bg-gray-100 text-black hover:bg-gray-200"
                        }`}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  {pagination && pagination.totalPages <= 1 && chats.length > 0 && (
                    <div className={`pt-2 text-center text-xs ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                      {isSearching 
                        ? `Showing all ${chats.length} result${chats.length !== 1 ? "s" : ""}`
                        : `Showing all ${pagination.total} chat${pagination.total !== 1 ? "s" : ""}`
                      }
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Debug Panel - Toggle with Ctrl+Shift+D */}
        {showDebug && (
          <div className={`mt-4 pt-4 border-t ${
            isDarkMode ? "border-gray-700" : "border-black/5"
          }`}>
            <button
              onClick={() => {
                const newState = !showDebug;
                setShowDebug(newState);
                // Persist in localStorage
                if (newState) {
                  localStorage.setItem("chatvault-debug-enabled", "true");
                } else {
                  localStorage.removeItem("chatvault-debug-enabled");
                }
              }}
              className={`w-full text-left px-2 py-1 rounded text-xs font-medium ${
                isDarkMode
                  ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {showDebug ? "▼" : "▶"} Debug Panel ({debugLogs.length} logs)
              <span className="ml-2 text-xs opacity-60">(Ctrl+Shift+D to toggle)</span>
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
        )}

        {/* Manual Save Modal */}
        {showManualSaveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-2xl rounded-lg ${
              isDarkMode ? "bg-gray-800" : "bg-white"
            } p-6 max-h-[90vh] flex flex-col`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-semibold ${
                  isDarkMode ? "text-white" : "text-black"
                }`}>
                  Save Chat Manually
                </h2>
                <button
                  onClick={handleCloseManualSaveModal}
                  className={`p-1 rounded ${
                    isDarkMode
                      ? "hover:bg-gray-700 text-gray-300"
                      : "hover:bg-gray-100 text-gray-600"
                  }`}
                >
                  <MdClose className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? "text-gray-300" : "text-gray-700"
                  }`}>
                    Title (optional)
                  </label>
                  <input
                    type="text"
                    value={manualSaveTitle}
                    onChange={(e) => setManualSaveTitle(e.target.value)}
                    placeholder="manual"
                    className={`w-full px-3 py-2 rounded-lg border ${
                      isDarkMode
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        : "bg-white border-gray-300 text-black placeholder-gray-500"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? "text-gray-300" : "text-gray-700"
                  }`}>
                    Paste ChatGPT Conversation
                  </label>
                  <textarea
                    value={manualSaveContent}
                    onChange={(e) => setManualSaveContent(e.target.value)}
                    placeholder="Paste the copied conversation here..."
                    rows={12}
                    className={`w-full px-3 py-2 rounded-lg border font-mono text-sm ${
                      isDarkMode
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        : "bg-white border-gray-300 text-black placeholder-gray-500"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none`}
                  />
                </div>

                {manualSaveError && (
                  <div className={`p-3 rounded-lg ${
                    isDarkMode ? "bg-red-900/30 border border-red-700" : "bg-red-50 border border-red-200"
                  }`}>
                    <p className={`text-sm ${
                      isDarkMode ? "text-red-300" : "text-red-700"
                    }`}>
                      {manualSaveError}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCloseManualSaveModal}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                    isDarkMode
                      ? "bg-gray-700 text-white hover:bg-gray-600"
                      : "bg-gray-100 text-black hover:bg-gray-200"
                  }`}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleManualSave}
                  disabled={isSaving || !manualSaveContent.trim()}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                    isSaving || !manualSaveContent.trim()
                      ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                      : isDarkMode
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("chat-vault-root")).render(<App />);
