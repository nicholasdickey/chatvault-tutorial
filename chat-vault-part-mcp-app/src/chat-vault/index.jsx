import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MdArrowBack, MdExpandMore, MdExpandLess, MdContentCopy, MdAdd, MdClose, MdCheck, MdSearch, MdRefresh, MdOpenInNew, MdDelete, MdHelp, MdFullscreen, MdFullscreenExit, MdPictureInPicture, MdNote, MdLogin, MdMessage, MdEdit } from "react-icons/md";

// Chat data structure (no TypeScript types in .jsx file)

// Widget version from environment variable (injected at build time via vite.config.mts)
const WIDGET_VERSION = import.meta.env.WIDGET_VERSION || "1.0.1";

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
  const [manualSaveHtml, setManualSaveHtml] = useState(""); // Store HTML from clipboard
  const [manualSaveError, setManualSaveError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [contentMetadata, setContentMetadata] = useState(null);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertPortalLink, setAlertPortalLink] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [helpText, setHelpText] = useState(null);
  const [helpTextLoading, setHelpTextLoading] = useState(false);
  const [subTitle, setSubTitle] = useState(null);
  const [subTitleExpanded, setSubTitleExpanded] = useState(false);
  const [displayMode, setDisplayMode] = useState("normal"); // "normal" | "fullscreen" | "pip"
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [editedTurns, setEditedTurns] = useState([]); // Local copy of turns being edited
  const [editingTurn, setEditingTurn] = useState(null); // { turnIndex: number, field: 'prompt' | 'response' }
  const [editingTurnValue, setEditingTurnValue] = useState(""); // Current value being edited
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingChat, setIsSavingChat] = useState(false);

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
              widgetVersion: WIDGET_VERSION,
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
              // Extract content metadata if present
              if (result.structuredContent.content) {
                setContentMetadata(result.structuredContent.content);
                addLog("Content metadata extracted", result.structuredContent.content);
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

  // Debug alert state changes
  useEffect(() => {
    if (alertMessage) {
      addLog("Alert message state changed", { alertMessage, alertPortalLink, deleteConfirmation });
    }
  }, [alertMessage, alertPortalLink, deleteConfirmation]);

  // Update alert message dynamically when userInfo changes (if counter alert is showing)
  useEffect(() => {
    if (alertMessage && !deleteConfirmation && userInfo?.isAnonymousPlan && userInfo.remainingSlots !== undefined) {
      // Check if this is a counter alert (starts with "You have X chat")
      if (alertMessage.includes("You have") && alertMessage.includes("to save remaining")) {
        const baseMessage = `You have ${userInfo.remainingSlots} chat${userInfo.remainingSlots !== 1 ? 's' : ''} to save remaining.`;
        const message = userInfo.remainingSlots <= 1
          ? `${baseMessage} Delete chats or`
          : baseMessage;
        setAlertMessage(message);
        setAlertPortalLink(userInfo.portalLink || null);
      }
    }
  }, [userInfo?.remainingSlots, userInfo?.portalLink, userInfo?.isAnonymousPlan]);

  // Handle ESC key to close help
  useEffect(() => {
    if (!showHelp) return;

    const handleEscKey = (e) => {
      if (e.key === "Escape") {
        setShowHelp(false);
      }
    };

    window.addEventListener("keydown", handleEscKey);
    return () => {
      window.removeEventListener("keydown", handleEscKey);
    };
  }, [showHelp]);

  // Deduplicate chats based on title and content
  // Keeps the most recent chat (by timestamp) when duplicates are found
  const deduplicateChats = (chatList) => {
    const seen = new Map();
    const deduplicated = [];

    for (const chat of chatList) {
      // Create a signature based on title and content (different for notes vs chats)
      let signature;
      if (chat.type === "note") {
        // For notes, use title and content
        signature = `${chat.title || ""}|${chat.content || ""}`;
      } else {
        // For chats, use title and first turn content
        const firstTurn = chat.turns?.[0];
        signature = `${chat.title || ""}|${firstTurn?.prompt || ""}|${firstTurn?.response || ""}`;
      }

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
    // Create a fresh copy of the chat object to avoid reference issues
    setSelectedChat({ ...chat });
    setExpandedTurns(new Set());
    // Reset editing state when switching chats
    setIsEditingTitle(false);
    setEditedTitle("");
    // Initialize editedTurns from selected chat (deep copy to avoid reference issues)
    setEditedTurns(chat.turns ? chat.turns.map(turn => ({ ...turn })) : []);
    setEditingTurn(null);
    setEditingTurnValue("");
    setHasUnsavedChanges(false);
    // Search state persists - don't clear it
  };

  const handleBackClick = () => {
    addLog("Back clicked");
    setSelectedChat(null);
    setExpandedTurns(new Set());
    // Reset editing state when going back
    setIsEditingTitle(false);
    setEditedTitle("");
    setEditedTurns([]);
    setEditingTurn(null);
    setEditingTurnValue("");
    setHasUnsavedChanges(false);
  };

  const handleFullscreen = async () => {
    try {
      if (!window.openai?.requestDisplayMode) {
        addLog("requestDisplayMode not available");
        setAlertMessage("Fullscreen mode not available in this environment");
        setAlertPortalLink(null);
        return;
      }

      if (displayMode === "fullscreen") {
        // Exit fullscreen - return to normal
        const response = await window.openai.requestDisplayMode({ mode: "normal" });
        setDisplayMode(response.mode || "normal");
        addLog("Exited fullscreen", response);
      } else {
        // Enter fullscreen
        const response = await window.openai.requestDisplayMode({ mode: "fullscreen" });
        setDisplayMode(response.mode || "fullscreen");
        addLog("Entered fullscreen", response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog("Fullscreen error", { error: errorMessage });
      setAlertMessage(`Failed to change display mode: ${errorMessage}`);
      setAlertPortalLink(null);
    }
  };

  const handlePipMode = async () => {
    try {
      if (!window.openai?.requestDisplayMode) {
        addLog("requestDisplayMode not available");
        setAlertMessage("Picture-in-Picture mode not available in this environment");
        setAlertPortalLink(null);
        return;
      }

      if (displayMode === "pip") {
        // Exit PiP - return to normal
        const response = await window.openai.requestDisplayMode({ mode: "normal" });
        setDisplayMode(response.mode || "normal");
        addLog("Exited PiP mode", response);
      } else {
        // Enter PiP
        const response = await window.openai.requestDisplayMode({ mode: "pip" });
        setDisplayMode(response.mode || "pip");
        addLog("Entered PiP mode", response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog("PiP mode error", { error: errorMessage });
      setAlertMessage(`Failed to enter PiP mode: ${errorMessage}`);
      setAlertPortalLink(null);
    }
  };

  const handleRefresh = async () => {
    addLog("Refresh clicked");
    setLoading(true);
    setError(null);
    try {
      if (window.openai?.callTool) {
        addLog("Calling loadMyChats via skybridge");
        addLog("loadMyChats parameters", {
          page: 0,
          size: 10,
          widgetVersion: WIDGET_VERSION,
        });
        const result = await window.openai.callTool("loadMyChats", {
          page: 0,
          size: 10,
          widgetVersion: WIDGET_VERSION,
        });
        addLog("loadMyChats result", result);
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

  const handleOpenWebsite = () => {
    if (userInfo?.portalLink) {
      addLog("Open on website clicked", { portalLink: userInfo.portalLink });
      window.open(userInfo.portalLink, "_blank");
    } else {
      addLog("Open on website clicked but no portal link available");
    }
  };

  const handleSignIn = () => {
    if (userInfo?.loginLink) {
      addLog("Sign in clicked", { loginLink: userInfo.loginLink });
      window.open(userInfo.loginLink, "_blank");
    } else {
      addLog("Sign in clicked but no login link available");
    }
  };

  const handleCounterClick = () => {
    if (userInfo?.isAnonymousPlan && userInfo.remainingSlots !== undefined) {
      const baseMessage = `You have ${userInfo.remainingSlots} chat${userInfo.remainingSlots !== 1 ? 's' : ''} to save remaining.`;
      const message = userInfo.remainingSlots <= 1
        ? `${baseMessage} Delete chats or`
        : baseMessage;

      addLog("Counter clicked - setting alert", { message, portalLink: userInfo.portalLink });
      setAlertMessage(message);
      setAlertPortalLink(userInfo.portalLink || null);
      addLog("Counter clicked - alert state set", { message });
    } else {
      addLog("Counter clicked but user is not on anonymous plan", { isAnonymousPlan: userInfo?.isAnonymousPlan });
    }
  };

  const handleCloseAlert = () => {
    if (deleteConfirmation) {
      handleCancelDelete();
    } else {
      setAlertMessage(null);
      setAlertPortalLink(null);
    }
  };

  const handleAlertPortalClick = () => {
    if (alertPortalLink) {
      window.open(alertPortalLink, "_blank");
      handleCloseAlert();
    }
  };

  const handleDeleteChat = async (chat) => {
    addLog("Delete chat clicked", { chatId: chat.id, title: chat.title });

    // Show confirmation in alert area
    setDeleteConfirmation({
      chatId: chat.id,
      title: chat.title,
      userId: chat.userId || (chats.length > 0 && chats[0].userId) || "",
    });
    setAlertMessage(`Are you sure you want to delete "${chat.title}"?`);
    setAlertPortalLink(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmation) return;

    const { chatId, userId } = deleteConfirmation;
    setDeleteConfirmation(null);
    setAlertMessage(null);
    setAlertPortalLink(null);

    // Show loading indicator during delete operation
    setPaginationLoading(true);

    try {
      if (!window.openai?.callTool) {
        throw new Error("deleteChat tool not available");
      }

      if (!userId) {
        throw new Error("User ID not available. Please refresh and try again.");
      }

      addLog("Calling deleteChat tool", { chatId, userId });
      const result = await window.openai.callTool("deleteChat", {
        chatId,
        userId,
      });

      addLog("Delete chat result", result);

      if (result?.structuredContent?.deleted) {
        // Remove from local state immediately
        setChats((prev) => prev.filter((c) => c.id !== chatId));
        addLog("Chat removed from local state");

        // Update userInfo counts locally
        if (userInfo) {
          setUserInfo((prev) => ({
            ...prev,
            totalChats: Math.max(0, (prev.totalChats || 0) - 1),
            remainingSlots: prev.remainingSlots !== undefined
              ? (prev.remainingSlots || 0) + 1
              : undefined,
          }));
          addLog("UserInfo counts updated locally");
        }

        // If deleted chat was selected, clear selection
        if (selectedChat?.id === chatId) {
          setSelectedChat(null);
        }
      } else {
        throw new Error(result?.structuredContent?.message || "Delete failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Error deleting chat", { error: errorMessage });
      setAlertMessage(`Failed to delete chat: ${errorMessage}`);
      setAlertPortalLink(null);
    } finally {
      // Hide loading indicator when done
      setPaginationLoading(false);
    }
  };

  const handleStartEditTitle = () => {
    if (!selectedChat) return;
    setEditedTitle(selectedChat.title);
    setIsEditingTitle(true);
    addLog("Started editing title", { currentTitle: selectedChat.title });
  };

  const handleCancelEditTitle = () => {
    setIsEditingTitle(false);
    setEditedTitle("");
    addLog("Cancelled editing title");
  };

  const handleSaveTitle = async () => {
    if (!selectedChat) return;

    const trimmedTitle = editedTitle.trim();

    // Local validation
    if (trimmedTitle.length === 0) {
      setAlertMessage("Title cannot be empty");
      setAlertPortalLink(null);
      return;
    }

    if (trimmedTitle.length > 2048) {
      setAlertMessage("Title cannot exceed 2048 characters");
      setAlertPortalLink(null);
      return;
    }

    // If title hasn't changed, just cancel editing
    if (trimmedTitle === selectedChat.title) {
      handleCancelEditTitle();
      return;
    }

    setIsUpdatingTitle(true);
    setAlertMessage(null);
    setAlertPortalLink(null);

    // Capture chatId and current title before async operation to avoid closure issues
    const chatId = selectedChat.id;
    const currentTitle = selectedChat.title;

    try {
      if (!window.openai?.callTool) {
        throw new Error("updateChat tool not available");
      }

      const userId = selectedChat.userId || (chats.length > 0 && chats[0].userId) || "";
      if (!userId) {
        throw new Error("User ID not available. Please refresh and try again.");
      }

      addLog("Calling updateChat tool", { chatId, userId, title: trimmedTitle });
      const result = await window.openai.callTool("updateChat", {
        chatId,
        userId,
        chat: {
          title: trimmedTitle,
        },
      });

      addLog("Update chat result", result);

      if (result?.structuredContent?.updated) {
        const newTitle = result.structuredContent.title || trimmedTitle;

        // Update selectedChat only if it's still the same chat
        setSelectedChat((prev) => (prev && prev.id === chatId ? { ...prev, title: newTitle } : prev));

        // Update chats list
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === chatId ? { ...chat, title: newTitle } : chat
          )
        );

        addLog("Title updated in local state", { chatId, newTitle });

        // Exit edit mode
        setIsEditingTitle(false);
        setEditedTitle("");
      } else {
        throw new Error(result?.structuredContent?.message || "Update failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Error updating chat title", { error: errorMessage });
      setAlertMessage(`Failed to update title: ${errorMessage}`);
      setAlertPortalLink(null);
    } finally {
      setIsUpdatingTitle(false);
    }
  };

  const handleStartEditTurn = (turnIndex, field) => {
    if (!selectedChat || !editedTurns[turnIndex]) return;
    const turn = editedTurns[turnIndex];
    setEditingTurn({ turnIndex, field });
    setEditingTurnValue(field === 'prompt' ? turn.prompt : turn.response);
    addLog("Started editing turn", { turnIndex, field });
  };

  const handleCancelEditTurn = () => {
    setEditingTurn(null);
    setEditingTurnValue("");
    addLog("Cancelled editing turn");
  };

  const handleSaveTurnEdit = (turnIndex, field) => {
    if (!selectedChat || !editedTurns[turnIndex]) return;

    const trimmedValue = editingTurnValue.trim();

    // Update the edited turn
    const updatedTurns = [...editedTurns];
    updatedTurns[turnIndex] = {
      ...updatedTurns[turnIndex],
      [field]: trimmedValue,
    };

    setEditedTurns(updatedTurns);
    setEditingTurn(null);
    setEditingTurnValue("");
    setHasUnsavedChanges(true);
    addLog("Turn edited", { turnIndex, field });
  };

  const handleDeleteTurn = (turnIndex) => {
    if (!selectedChat || editedTurns.length <= 1) {
      setAlertMessage("Cannot delete the last turn. A chat must have at least one turn.");
      setAlertPortalLink(null);
      return;
    }

    const updatedTurns = editedTurns.filter((_, index) => index !== turnIndex);
    setEditedTurns(updatedTurns);
    setHasUnsavedChanges(true);
    addLog("Turn deleted", { turnIndex, remainingTurns: updatedTurns.length });
  };

  const handleSaveChat = async () => {
    if (!selectedChat) return;

    // Validate: at least one turn
    if (editedTurns.length === 0) {
      setAlertMessage("Chat must have at least one turn");
      setAlertPortalLink(null);
      return;
    }

    // Validate each turn (notes can have empty response, but must have prompt)
    for (let i = 0; i < editedTurns.length; i++) {
      const turn = editedTurns[i];
      if (!turn.prompt || turn.prompt.trim().length === 0) {
        setAlertMessage(`Turn ${i + 1} must have a prompt`);
        setAlertPortalLink(null);
        return;
      }
      // Response is optional (for notes), but if present must be a string
      if (turn.response !== undefined && typeof turn.response !== "string") {
        setAlertMessage(`Turn ${i + 1} response must be a string`);
        setAlertPortalLink(null);
        return;
      }
    }

    setIsSavingChat(true);
    setAlertMessage(null);
    setAlertPortalLink(null);

    // Capture chatId before async operation
    const chatId = selectedChat.id;

    try {
      if (!window.openai?.callTool) {
        throw new Error("updateChat tool not available");
      }

      const userId = selectedChat.userId || (chats.length > 0 && chats[0].userId) || "";
      if (!userId) {
        throw new Error("User ID not available. Please refresh and try again.");
      }

      addLog("Calling updateChat tool with turns", { chatId, userId, turnsCount: editedTurns.length });
      const result = await window.openai.callTool("updateChat", {
        chatId,
        userId,
        chat: {
          turns: editedTurns,
        },
      });

      addLog("Update chat result", result);

      if (result?.structuredContent?.updated) {
        const updatedTurns = result.structuredContent.turns || editedTurns;

        // Update selectedChat
        setSelectedChat((prev) => (prev && prev.id === chatId ? { ...prev, turns: updatedTurns } : prev));

        // Update chats list
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === chatId ? { ...chat, turns: updatedTurns } : chat
          )
        );

        addLog("Chat turns updated in local state", { chatId, turnsCount: updatedTurns.length });

        // Clear editing state
        setHasUnsavedChanges(false);
        setEditingTurn(null);
        setEditingTurnValue("");
      } else {
        throw new Error(result?.structuredContent?.message || "Update failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Error updating chat turns", { error: errorMessage });
      setAlertMessage(`Failed to update chat: ${errorMessage}`);
      setAlertPortalLink(null);
    } finally {
      setIsSavingChat(false);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmation(null);
    setAlertMessage(null);
    setAlertPortalLink(null);
    addLog("Delete cancelled by user");
  };

  // Convert markdown to HTML
  const markdownToHtml = (markdown) => {
    if (!markdown) return "";

    let html = markdown;

    // Convert headers (do this first before paragraph processing)
    html = html.replace(/^### (.*$)/gim, '<h5 class="text-base font-semibold mt-6 mb-3">$1</h5>');
    html = html.replace(/^## (.*$)/gim, '<h4 class="text-lg font-semibold mt-6 mb-3">$1</h4>');
    html = html.replace(/^# (.*$)/gim, '<h3 class="text-xl font-semibold mt-6 mb-4">$1</h3>');

    // Convert links [text](url) - do this before bold to avoid conflicts
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline hover:no-underline">$1</a>');

    // Convert bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Convert line breaks to paragraphs (double newline = paragraph, single = br)
    const paragraphs = html.split(/\n\s*\n/);
    html = paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // Replace single newlines with <br> within paragraphs
      const withBreaks = trimmed.replace(/\n/g, '<br />');
      return `<p class="mb-3">${withBreaks}</p>`;
    }).join('');

    return html;
  };

  const handleHelpClick = async () => {
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    // If help text is already cached, just show it
    if (helpText) {
      setShowHelp(true);
      return;
    }

    // Show help panel and fetch help text on demand
    setShowHelp(true);
    setHelpTextLoading(true);

    try {
      if (!window.openai?.callTool) {
        throw new Error("explainHowToUse tool not available");
      }

      // Get userId from chats
      const userId = selectedChat?.userId || (chats.length > 0 && chats[0].userId) || "";

      if (!userId) {
        throw new Error("User ID not available. Please refresh and try again.");
      }

      addLog("Calling explainHowToUse tool", { userId });
      const result = await window.openai.callTool("explainHowToUse", {
        userId,
      });

      addLog("explainHowToUse result", result);

      if (result?.structuredContent?.helpText) {
        const rawHelpText = result.structuredContent.helpText;
        // Replace placeholders in help text
        const expirationDays = contentMetadata?.config?.chatExpirationDays ?? 7;
        const processedHelpText = rawHelpText.replace(/{expirationDays}/g, String(expirationDays));
        setHelpText(processedHelpText);
      } else {
        throw new Error("No help text received from server");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog("Error loading help text", { error: errorMessage });
      setAlertMessage(`Failed to load help text: ${errorMessage}`);
      setAlertPortalLink(null);
      // Keep help panel open but show error state
    } finally {
      setHelpTextLoading(false);
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
      setAlertMessage("Unable to copy to clipboard automatically. The text has been logged to the debug panel. Please copy it manually.");
      setAlertPortalLink(null);
    }
  };

  const formatChatForCopy = (chat) => {
    if (!chat) {
      return "";
    }

    // Handle notes differently
    if (chat.type === "note") {
      return chat.content || "";
    }

    // Handle chats with turns
    if (!chat.turns || chat.turns.length === 0) {
      return "";
    }

    return chat.turns
      .map((turn) => {
        return `You said:\n${turn.prompt}\n\nAI said:\n${turn.response}`;
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
      setManualSaveError("Please paste the chat conversation");
      return;
    }

    setIsSaving(true);
    setManualSaveError(null);

    const contentToSend = manualSaveHtml || manualSaveContent;
    const titleToSend = manualSaveTitle.trim() || undefined;

    addLog("🚀 [WIDGET] Starting manual save", {
      hasTitle: !!titleToSend,
      title: titleToSend || "(none)",
      contentLength: contentToSend.length,
      contentPreview: contentToSend.substring(0, 200),
      hasHtml: !!manualSaveHtml,
      htmlLength: manualSaveHtml?.length || 0,
      textLength: manualSaveContent?.length || 0,
    });

    try {
      if (!window.openai?.callTool) {
        throw new Error("widgetAdd tool not available");
      }

      const toolArgs = {
        htmlContent: contentToSend,
        title: titleToSend,
        widgetVersion: WIDGET_VERSION,
      };

      addLog("📤 [WIDGET] Calling widgetAdd tool", {
        toolName: "widgetAdd",
        args: {
          htmlContentLength: toolArgs.htmlContent.length,
          htmlContentPreview: toolArgs.htmlContent.substring(0, 200),
          title: toolArgs.title || "(none)",
        },
      });

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Request timed out after 30 seconds")), 30000);
      });

      const callToolPromise = window.openai.callTool("widgetAdd", toolArgs);

      addLog("⏳ [WIDGET] Waiting for response...");
      const result = await Promise.race([callToolPromise, timeoutPromise]);
      addLog("✅ [WIDGET] Response received");

      addLog("📥 [WIDGET] Manual save result received", {
        resultType: typeof result,
        isNull: result === null,
        isUndefined: result === undefined,
        hasError: !!result?.error,
        hasStructuredContent: !!result?.structuredContent,
        hasContent: !!result?.content,
        keys: result ? Object.keys(result) : [],
        structuredContentKeys: result?.structuredContent ? Object.keys(result.structuredContent) : [],
        structuredContentError: result?.structuredContent?.error || "(none)",
        structuredContentMessage: result?.structuredContent?.message || "(none)",
        structuredContentChatId: result?.structuredContent?.chatId || "(none)",
        structuredContentSaved: result?.structuredContent?.saved,
        structuredContentTurnsCount: result?.structuredContent?.turnsCount,
        contentText: result?.content?.[0]?.text?.substring(0, 200) || "(none)",
        fullResultPreview: JSON.stringify(result).substring(0, 1000),
      });

      // If result is null/undefined, that's an error
      if (result == null) {
        addLog("❌ [WIDGET] No response received from server");
        throw new Error("No response received from server");
      }

      // Check for errors in the response (multiple possible formats)
      if (result?.error) {
        const errorMessage = result.error.message || result.error?.data || result.error || "Unknown error occurred";
        addLog("❌ [WIDGET] Error found in result.error", {
          error: result.error,
          errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Check for JSON-RPC error format
      if (result?.jsonrpc === "2.0" && result?.error) {
        const errorMessage = result.error.message || result.error.data || "Unknown error occurred";
        addLog("❌ [WIDGET] JSON-RPC error found", {
          error: result.error,
          errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Check if content indicates an error
      if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
        const firstContent = result.content[0];
        if (firstContent?.text) {
          const text = firstContent.text;
          addLog("📄 [WIDGET] Content text found", { text: text.substring(0, 200) });
          if (text.toLowerCase().includes("error") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("could not parse")) {
            addLog("❌ [WIDGET] Error text found in content", { text });
            throw new Error(text);
          }
        }
      }

      // Check structuredContent for error indicators
      if (result?.structuredContent) {
        addLog("📋 [WIDGET] Checking structuredContent", {
          error: result.structuredContent.error || "(none)",
          saved: result.structuredContent.saved,
          chatId: result.structuredContent.chatId || "(none)",
          turnsCount: result.structuredContent.turnsCount,
          message: result.structuredContent.message || "(none)",
        });

        // Check for limit_reached error specifically
        if (result.structuredContent.error === "limit_reached") {
          const message = result.structuredContent.message || "Chat limit reached";
          const portalLink = result.structuredContent.portalLink;
          addLog("❌ [WIDGET] Limit reached error", { message, portalLink });

          // Show error in alert area (close modal first)
          setShowManualSaveModal(false);
          setManualSaveError(null);
          setAlertMessage(message);
          setAlertPortalLink(portalLink || null);
          return; // Don't throw, just show error in alert
        }

        // Parse errors are now handled by backend - content is saved as note instead of erroring
        // No need to handle parse_error here anymore

        // Check for server_error
        if (result.structuredContent.error === "server_error") {
          const message = result.structuredContent.message || "An error occurred while saving the chat";
          addLog("❌ [WIDGET] Server error in structuredContent", {
            message,
            error: result.structuredContent.error,
            fullResult: result,
          });

          // Show error in alert area (close modal first)
          setShowManualSaveModal(false);
          setManualSaveError(null);
          setAlertMessage(message);
          setAlertPortalLink(null);
          setIsSaving(false);
          return; // Don't throw, just show error in alert
        }

        if (result.structuredContent.error) {
          const errorMessage = result.structuredContent.error.message || result.structuredContent.error || "Unknown error occurred";
          addLog("❌ [WIDGET] Error found in structuredContent.error", {
            error: result.structuredContent.error,
            errorMessage,
            fullStructuredContent: result.structuredContent,
          });
          throw new Error(errorMessage);
        }
        // Also check if structuredContent has an error-like structure
        if (result.structuredContent.saved === false || result.structuredContent.success === false) {
          const errorMessage = result.structuredContent.message || result.structuredContent.error || "Save operation failed";
          addLog("❌ [WIDGET] Save failed indicated in structuredContent", {
            saved: result.structuredContent.saved,
            success: result.structuredContent.success,
            errorMessage,
            fullStructuredContent: result.structuredContent,
          });
          throw new Error(errorMessage);
        }
      }

      addLog("✅ [WIDGET] Manual save successful", {
        chatId: result?.structuredContent?.chatId || "(none)",
        saved: result?.structuredContent?.saved,
        turnsCount: result?.structuredContent?.turnsCount,
        fullResult: result,
      });

      // Close modal and reset form on success
      setShowManualSaveModal(false);
      setManualSaveTitle("");
      setManualSaveContent("");
      setManualSaveHtml("");
      setManualSaveError(null);

      // Clear search filter when adding a new chat/note
      setSearchQuery("");
      setIsSearching(false);

      // Show loading indicator immediately after modal closes (same as pagination)
      setPaginationLoading(true);

      // Reload chats and update userInfo with loading indicator
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
            // Update content metadata if present
            if (loadResult.structuredContent.content) {
              setContentMetadata(loadResult.structuredContent.content);
            }
          }

        } catch (err) {
          addLog("Error reloading chats after manual save", { error: err.message });
          setError(`Failed to reload chats: ${err.message}`);
        } finally {
          setPaginationLoading(false);
        }
      } else {
        setPaginationLoading(false);
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

      addLog("❌ [WIDGET] Manual save failed", {
        error: errorMessage,
        errorType: typeof err,
        errorString: String(err),
        errorName: err?.name || "(none)",
        errorStack: err?.stack || "(none)",
        errorMessage: err?.message || "(none)",
        fullError: err,
      });
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
    setManualSaveHtml("");
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
        widgetVersion: WIDGET_VERSION,
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
          widgetVersion: WIDGET_VERSION,
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
          widgetVersion: WIDGET_VERSION,
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
      <rect x="0" y="0" width="1024" height="1024" rx="220" fill="#0F172A" />
      <circle cx="512" cy="512" r="300" fill="none" stroke="#E5E7EB" strokeWidth="80" />
      <rect x="492" y="212" width="40" height="120" rx="20" fill="#E5E7EB" />
      <rect x="492" y="692" width="40" height="120" rx="20" fill="#E5E7EB" />
      <rect x="212" y="492" width="120" height="40" rx="20" fill="#E5E7EB" />
      <rect x="692" y="492" width="120" height="40" rx="20" fill="#E5E7EB" />
      <circle cx="512" cy="512" r="40" fill="#E5E7EB" />
      <rect x="590" y="350" width="220" height="140" rx="40" fill="#3B82F6" />
      <path d="M650 490 L620 560 L700 500 Z" fill="#3B82F6" />
      <rect x="630" y="385" width="140" height="16" rx="8" fill="#E5E7EB" />
      <rect x="630" y="420" width="100" height="16" rx="8" fill="#E5E7EB" />
    </svg>
  );

  if (loading && chats.length === 0) {
    return (
      <div className={`antialiased w-full px-4 py-6 border rounded-2xl sm:rounded-3xl overflow-hidden ${isDarkMode
        ? "bg-gray-900 border-gray-700 text-white"
        : "bg-white border-black/10 text-black"
        }`}>
        <div className="text-center text-sm opacity-60">Loading chats...</div>
      </div>
    );
  }

  return (
    <div className={`antialiased w-full text-black px-4 pb-2 border rounded-2xl sm:rounded-3xl overflow-hidden ${isDarkMode
      ? "bg-gray-900 border-gray-700 text-white"
      : "bg-white border-black/10 text-black"
      }`}>
      <div className="max-w-full relative">
        {/* Toolbar */}
        <div className={`flex flex-row items-center justify-between gap-2 py-3 border-b ${isDarkMode ? "border-gray-700" : "border-black/5"
          }`}>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${isDarkMode ? "bg-blue-900/50 text-blue-300" : "bg-blue-100 text-blue-700"}`}
              title="MCP App · Ctrl+Shift+D to open debug panel"
            >
              MCP App
            </span>
            {selectedChat ? (
              <button
                onClick={handleBackClick}
                className={`p-2 rounded-lg ${isDarkMode
                  ? "bg-gray-800 text-white hover:bg-gray-700"
                  : "bg-gray-100 text-black hover:bg-gray-200"
                  }`}
                title="Back"
              >
                <MdArrowBack className="w-5 h-5" />
              </button>
            ) :
              <button
                onClick={handleRefresh}
                className={`p-2 rounded-lg transition-colors ${isDarkMode
                  ? "hover:bg-gray-800 text-gray-300"
                  : "hover:bg-gray-100 text-gray-600"
                  }`}
                title="Refresh chats"
              >
                <MdRefresh className="w-5 h-5" />
              </button>}
          </div>
          <div className="flex items-center gap-2">
            {userInfo?.userName && !userInfo?.isAnon ? (
              <button
                onClick={handleOpenWebsite}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${isDarkMode
                  ? "text-gray-300 hover:text-gray-200 hover:bg-gray-800"
                  : "text-gray-700 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                title="Open on the website"
              >
                {userInfo.userName}
              </button>
            ) : userInfo?.isAnonymousPlan && userInfo?.portalLink ? (
              <button
                onClick={handleSignIn}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${isDarkMode
                  ? "bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-300"
                  : "bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
                  }`}
                title="Sign in for long-term persistence"
              >
                <MdLogin className="w-4 h-4" />
                <span>Sign In</span>
              </button>
            ) : null}
            {userInfo?.isAnonymousPlan && userInfo.remainingSlots !== undefined && (
              <button
                onClick={handleCounterClick}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isDarkMode
                  ? "bg-gray-800 border-gray-600 hover:bg-gray-700"
                  : "bg-white border-gray-300 hover:bg-gray-50"
                  } ${userInfo.remainingSlots === 0
                    ? "text-red-500"
                    : userInfo.remainingSlots === 1
                      ? "text-yellow-500"
                      : "text-green-500"
                  }`}
                title={contentMetadata?.limits?.counterTooltip ?? "Click to learn about chat limits"}
              >
                {userInfo.remainingSlots}
              </button>
            )}
            <button
              onClick={handleOpenWebsite}
              className={`p-2 rounded-lg transition-colors ${isDarkMode
                ? "hover:bg-gray-800 text-gray-300"
                : "hover:bg-gray-100 text-gray-600"
                }`}
              title="Open on the website"
            >
              <MdOpenInNew className="w-5 h-5" />
            </button>
            <button
              onClick={handleFullscreen}
              className={`p-2 rounded-lg transition-colors ${isDarkMode
                ? "hover:bg-gray-800 text-gray-300"
                : "hover:bg-gray-100 text-gray-600"
                } ${!window.openai?.requestDisplayMode ? "opacity-50 cursor-not-allowed" : ""
                }`}
              title={displayMode === "fullscreen" ? "Exit fullscreen" : "Enter fullscreen"}
              disabled={!window.openai?.requestDisplayMode}
            >
              {displayMode === "fullscreen" ? (
                <MdFullscreenExit className="w-5 h-5" />
              ) : (
                <MdFullscreen className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
        {/* Delete Confirmation Modal - Centered Overlay */}
        {deleteConfirmation && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 min-h-screen">
            <div className={`w-full max-w-md rounded-lg ${isDarkMode ? "bg-gray-800" : "bg-white"
              } p-6 shadow-xl`}>
              <div className={`text-sm mb-4 ${isDarkMode ? "text-gray-300" : "text-gray-700"
                }`}>
                {alertMessage}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelDelete}
                  className={`px-4 py-2 rounded text-sm font-medium ${isDarkMode
                    ? "bg-gray-700 text-white hover:bg-gray-600"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className={`px-4 py-2 rounded text-sm font-medium ${isDarkMode
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-red-500 text-white hover:bg-red-600"
                    }`}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Alert Area - Regular alerts (not delete confirmation) */}
        {alertMessage && !deleteConfirmation && (() => {
          console.log("[ChatVault] Rendering alert", { alertMessage, alertPortalLink });
          return (
            <div
              className={`flex items-center justify-between gap-3 p-3 rounded-lg border mb-2 ${isDarkMode ? "bg-gray-800 border-gray-600" : "bg-gray-50 border-gray-200"
                } ${userInfo?.isAnonymousPlan && userInfo.remainingSlots !== undefined
                  ? userInfo.remainingSlots === 0
                    ? "border-red-500"
                    : userInfo.remainingSlots === 1
                      ? "border-yellow-500"
                      : "border-green-500"
                  : "border-gray-300"
                }`}>
              <div className={`flex-1 text-sm ${isDarkMode ? "text-gray-300" : "text-gray-700"
                }`}>
                {alertMessage}
                {alertPortalLink && (
                  <> Click <button
                    onClick={handleAlertPortalClick}
                    className={`underline font-medium ${isDarkMode
                      ? "text-blue-400 hover:text-blue-300"
                      : "text-blue-600 hover:text-blue-700"
                      }`}
                  >
                    here
                  </button> to manage your account settings.</>
                )}
              </div>
              <button
                onClick={handleCloseAlert}
                className={`p-1 rounded ${isDarkMode
                  ? "text-gray-400 hover:text-gray-300 hover:bg-gray-700"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                  }`}
                title="Close"
              >
                <MdClose className="w-4 h-4" />
              </button>
            </div>
          );
        })()}
        {/* Header */}
        {!showHelp && <div className={`flex flex-row items-center gap-4 sm:gap-4 border-b py-4 ${isDarkMode ? "border-gray-700" : "border-black/5"
          }`}>
          <div
            className={`sm:w-18 w-16 aspect-square rounded-xl flex items-center justify-center overflow-hidden ${selectedChat ? "cursor-pointer hover:opacity-80" : ""
              }`}
            onClick={selectedChat ? handleBackClick : undefined}
            title={selectedChat ? "Back to conversations" : undefined}
          >
            <ChatVaultLogo />
          </div>
          <div className="flex-1">
            <div
              className={`text-base sm:text-xl font-medium ${selectedChat ? "cursor-pointer hover:opacity-80" : ""
                }`}
              onClick={selectedChat ? handleBackClick : undefined}
              title={selectedChat ? "Back to conversations" : undefined}
            >
              The Chat Vault
            </div>
            <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
              {selectedChat ? (
                selectedChat.title
              ) : contentMetadata?.subTitle ? (
                <span
                  onClick={() => {
                    if (contentMetadata.subTitle && contentMetadata.subTitle.length > 64) {
                      setSubTitleExpanded(!subTitleExpanded);
                    }
                  }}
                  className={contentMetadata.subTitle.length > 64 ? "cursor-pointer hover:opacity-80" : ""}
                  title={contentMetadata.subTitle.length > 64 ? (subTitleExpanded ? "Click to collapse" : "Click to expand") : ""}
                >
                  {subTitleExpanded || contentMetadata.subTitle.length <= 64
                    ? contentMetadata.subTitle
                    : `${contentMetadata.subTitle.substring(0, 64)}...`}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            {/* PiP button - commented out until PiP mode is working */}
            {/* <button
              onClick={handlePipMode}
              className={`p-2 rounded-lg transition-colors ${
                displayMode === "pip"
                  ? isDarkMode
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-blue-500 text-white hover:bg-blue-600"
                  : isDarkMode
                  ? "bg-gray-800 text-white hover:bg-gray-700"
                  : "bg-gray-100 text-black hover:bg-gray-200"
              } ${
                !window.openai?.requestDisplayMode ? "opacity-50 cursor-not-allowed" : ""
              }`}
              title={displayMode === "pip" ? "Exit picture-in-picture" : "Enter picture-in-picture"}
              disabled={!window.openai?.requestDisplayMode}
            >
              <MdPictureInPicture className="w-5 h-5" />
            </button> */}

            <button
              onClick={() => {
                // Check if limit reached for users on anonymous plan
                if (userInfo?.isAnonymousPlan && userInfo.remainingSlots === 0) {
                  const maxChats = userInfo.totalChats !== undefined && userInfo.remainingSlots !== undefined
                    ? userInfo.totalChats + userInfo.remainingSlots
                    : (contentMetadata?.config?.freeChatLimit ?? 10);
                  const messageTemplate = userInfo.portalLink
                    ? (contentMetadata?.limits?.limitReachedMessageWithPortal ?? "You've reached the limit of {maxChats} free chats. Delete a chat to add more, or upgrade your account to save unlimited chats.")
                    : (contentMetadata?.limits?.limitReachedMessageWithoutPortal ?? "You've reached the limit of {maxChats} free chats. Please delete a chat to add more.");
                  const message = messageTemplate.replace(/{maxChats}/g, String(maxChats));
                  setAlertMessage(message);
                  setAlertPortalLink(userInfo.portalLink || null);
                  return;
                }
                // Clear alert when opening save modal
                setAlertMessage(null);
                setAlertPortalLink(null);
                setShowManualSaveModal(true);
              }}
              disabled={paginationLoading || searchLoading}
              className={`p-2 rounded-lg transition-colors ${paginationLoading || searchLoading
                ? "opacity-50 cursor-not-allowed"
                : ""
                } ${userInfo?.isAnonymousPlan && userInfo.remainingSlots === 0
                  ? "hover:bg-gray-100"
                  : isDarkMode
                    ? "bg-gray-800 text-white hover:bg-gray-700"
                    : "bg-gray-100 text-black hover:bg-gray-200"
                }`}
              title={userInfo?.isAnonymousPlan && userInfo.remainingSlots === 0
                ? (contentMetadata?.limits?.limitReachedTooltip ?? "Chat limit reached - delete a chat or upgrade")
                : "Save chat manually"}
            >
              <MdAdd className={`w-5 h-5 ${userInfo?.isAnonymousPlan && userInfo.remainingSlots === 0
                ? "text-red-500"
                : ""
                }`} />
            </button>

          </div>
        </div>}

        {/* Search Box - Only show when not viewing a chat */}
        {!selectedChat && !showHelp && (
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
                  className={`w-full px-3 py-2 pl-10 pr-10 rounded-lg border text-sm ${paginationLoading || searchLoading
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                    } ${isDarkMode
                      ? "bg-gray-800 border-gray-600 text-white placeholder-gray-400"
                      : "bg-white border-gray-300 text-black placeholder-gray-500"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
                {isSearching ? (
                  <button
                    onClick={handleClearSearch}
                    disabled={paginationLoading || searchLoading}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${paginationLoading || searchLoading
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                      } ${isDarkMode
                        ? "text-gray-400 hover:text-gray-300 hover:bg-gray-700"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                      }`}
                    title="Clear search (Esc)"
                  >
                    <MdClose className="w-4 h-4" />
                  </button>
                ) : (
                  <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? "text-gray-400" : "text-gray-500"
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
                className={`p-2 rounded-lg ${((!searchQuery.trim() && !isSearching) || searchLoading || paginationLoading)
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
        {!showHelp && <div className="min-w-full text-sm flex flex-col py-8">
          {selectedChat ? (
            // Chat detail view
            <div className="space-y-4 pb-20">
              <div className={`p-4 rounded-lg ${isDarkMode ? "bg-gray-800" : "bg-gray-50"
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {isEditingTitle ? (
                      // Inline editing mode
                      <div className="mb-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveTitle();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                handleCancelEditTitle();
                              }
                            }}
                            disabled={isUpdatingTitle}
                            autoFocus
                            maxLength={2048}
                            className={`flex-1 px-2 py-1 rounded border text-sm font-medium ${isUpdatingTitle
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                              } ${isDarkMode
                                ? "bg-gray-700 border-gray-600 text-white"
                                : "bg-white border-gray-300 text-black"
                              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                          />
                          <button
                            onClick={handleSaveTitle}
                            disabled={isUpdatingTitle || editedTitle.trim().length === 0 || editedTitle.trim().length > 2048}
                            className={`p-1 rounded flex items-center flex-shrink-0 ${isUpdatingTitle || editedTitle.trim().length === 0 || editedTitle.trim().length > 2048
                              ? "opacity-50 cursor-not-allowed"
                              : isDarkMode
                                ? "bg-green-600 text-white hover:bg-green-700"
                                : "bg-green-600 text-white hover:bg-green-700"
                              }`}
                            title="Save"
                          >
                            {isUpdatingTitle ? (
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <MdCheck className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            onClick={handleCancelEditTitle}
                            disabled={isUpdatingTitle}
                            className={`p-1 rounded flex items-center flex-shrink-0 ${isUpdatingTitle
                              ? "opacity-50 cursor-not-allowed"
                              : isDarkMode
                                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                              }`}
                            title="Cancel"
                          >
                            <MdClose className="w-3 h-3" />
                          </button>
                        </div>
                        {editedTitle.trim().length > 2048 && (
                          <div className={`text-xs mt-1 ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
                            Title cannot exceed 2048 characters
                          </div>
                        )}
                      </div>
                    ) : (
                      // Display mode
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-medium flex-1">{selectedChat.title}</div>
                        <button
                          onClick={handleStartEditTitle}
                          className={`p-1 rounded flex items-center flex-shrink-0 ${isDarkMode
                            ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                          title="Edit title"
                        >
                          <MdEdit className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <div className={`text-xs ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>

                      <div className={`text-xs flex items-center gap-1 ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                        {(() => {
                          const currentTurns = editedTurns.length > 0 ? editedTurns : selectedChat.turns;
                          return currentTurns.length === 1 && !currentTurns[0].response;
                        })() ? (
                          <MdNote className={`w-3 h-3 ${isDarkMode ? "text-purple-400" : "text-purple-600"}`} />
                        ) : (
                          <MdMessage className={`w-3 h-3 ${isDarkMode ? "text-blue-400" : "text-blue-600"}`} />
                        )}
                        {formatDate(selectedChat.timestamp)}
                        {(() => {
                          const currentTurns = editedTurns.length > 0 ? editedTurns : selectedChat.turns;
                          return currentTurns.length === 1 && !currentTurns[0].response;
                        })() ? (
                          " • Note"
                        ) : (
                          ` • ${(() => {
                            const currentTurns = editedTurns.length > 0 ? editedTurns : selectedChat.turns;
                            return currentTurns?.length || 0;
                          })()} turn${(() => {
                            const currentTurns = editedTurns.length > 0 ? editedTurns : selectedChat.turns;
                            return (currentTurns?.length || 0) !== 1 ? "s" : "";
                          })()}`
                        )}
                      </div>

                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyEntireChat(selectedChat);
                    }}
                    className={`p-1 rounded flex items-center flex-shrink-0 ${isDarkMode
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                      }`}
                    title="Copy entire chat"
                  >
                    {copiedItems[`chat-${selectedChat.timestamp}`] ? (
                      <MdCheck className="w-3 h-3 text-green-500" />
                    ) : (
                      <MdContentCopy className="w-3 h-3" />
                    )}
                  </button>
                  {hasUnsavedChanges && (
                    <button
                      onClick={handleSaveChat}
                      disabled={isSavingChat}
                      className={`p-1 rounded flex items-center flex-shrink-0 ${isSavingChat
                        ? "opacity-50 cursor-not-allowed"
                        : isDarkMode
                          ? "bg-green-600 text-white hover:bg-green-700"
                          : "bg-green-600 text-white hover:bg-green-700"
                        }`}
                      title="Save changes"
                    >
                      {isSavingChat ? (
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <MdCheck className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {selectedChat.turns.length === 1 && !selectedChat.turns[0].response ? (
                // Note rendering - single card with prompt (same style as turn prompt)
                (() => {
                  const noteTurns = editedTurns.length > 0 ? editedTurns : selectedChat.turns;
                  const noteTurn = noteTurns[0];
                  const noteIndex = 0;
                  const isExpanded = expandedTurns.has(noteIndex);
                  const noteId = `note-${selectedChat.timestamp}`;
                  const noteCopied = !!copiedItems[noteId];
                  const isEditingNote = editingTurn?.turnIndex === noteIndex && editingTurn?.field === 'prompt';

                  // Check if note needs truncation (longer than 150 chars)
                  const maxLength = 150;
                  const noteNeedsTruncation = noteTurn.prompt.length > maxLength;

                  return (
                    <div className={`space-y-2 p-4 rounded-lg border ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                      }`}>
                      {/* Note */}
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className={`text-xs font-medium ${isDarkMode ? "text-purple-400" : "text-purple-600"
                            }`}>
                            Note
                          </div>
                          <div className="flex items-center gap-1">
                            {!isEditingNote && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    copyToClipboard(noteTurn.prompt, noteId);
                                  }}
                                  className={`p-0.5 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Copy note"
                                >
                                  {noteCopied ? (
                                    <MdCheck className="w-3 h-3 text-green-500" />
                                  ) : (
                                    <MdContentCopy className="w-3 h-3" />
                                  )}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleStartEditTurn(noteIndex, 'prompt');
                                  }}
                                  className={`p-0.5 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Edit note"
                                >
                                  <MdEdit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDeleteTurn(noteIndex);
                                  }}
                                  disabled={noteTurns.length <= 1}
                                  className={`p-0.5 rounded flex items-center flex-shrink-0 ${noteTurns.length <= 1
                                    ? "opacity-50 cursor-not-allowed"
                                    : isDarkMode
                                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title={noteTurns.length <= 1 ? "Cannot delete the last turn" : "Delete note"}
                                >
                                  <MdDelete className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            {noteNeedsTruncation && !isEditingNote && (
                              <button
                                onClick={() => toggleTurnExpansion(noteIndex)}
                                className={`p-1 rounded ${isDarkMode
                                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                  }`}
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? (
                                  <MdExpandLess className="w-3 h-3" />
                                ) : (
                                  <MdExpandMore className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className={`text-sm ${isDarkMode ? "text-gray-200" : "text-gray-800"}`}>
                          {isEditingNote ? (
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <textarea
                                  value={editingTurnValue}
                                  onChange={(e) => setEditingTurnValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                      e.preventDefault();
                                      handleSaveTurnEdit(noteIndex, 'prompt');
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      handleCancelEditTurn();
                                    }
                                  }}
                                  autoFocus
                                  rows={4}
                                  className={`flex-1 px-2 py-1 rounded border text-sm ${isDarkMode
                                    ? "bg-gray-700 border-gray-600 text-white"
                                    : "bg-white border-gray-300 text-black"
                                    } focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y`}
                                />
                                <button
                                  onClick={() => handleSaveTurnEdit(noteIndex, 'prompt')}
                                  disabled={editingTurnValue.trim().length === 0}
                                  className={`p-1 rounded flex items-center flex-shrink-0 ${editingTurnValue.trim().length === 0
                                    ? "opacity-50 cursor-not-allowed"
                                    : isDarkMode
                                      ? "bg-green-600 text-white hover:bg-green-700"
                                      : "bg-green-600 text-white hover:bg-green-700"
                                    }`}
                                  title="Save (Ctrl+Enter)"
                                >
                                  <MdCheck className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={handleCancelEditTurn}
                                  className={`p-1 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Cancel (Esc)"
                                >
                                  <MdClose className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`${noteNeedsTruncation && !isExpanded ? "cursor-pointer hover:opacity-80" : ""}`}
                              onClick={noteNeedsTruncation && !isExpanded ? () => toggleTurnExpansion(noteIndex) : undefined}
                              onMouseDown={(e) => {
                                // If expanded, allow text selection by not preventing default
                                if (isExpanded) {
                                  return; // Allow normal text selection
                                }
                                // If not expanded and clickable, prevent text selection on click
                                if (noteNeedsTruncation) {
                                  e.preventDefault();
                                }
                              }}
                              dangerouslySetInnerHTML={{
                                __html: isExpanded
                                  ? markdownToHtml(noteTurn.prompt)
                                  : markdownToHtml(truncateText(noteTurn.prompt))
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                // Chat rendering - turns with prompt/response
                (editedTurns.length > 0 ? editedTurns : selectedChat.turns)?.map((turn, index) => {
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

                  const isEditingPrompt = editingTurn?.turnIndex === index && editingTurn?.field === 'prompt';
                  const isEditingResponse = editingTurn?.turnIndex === index && editingTurn?.field === 'response';

                  return (
                    <div key={index} className={`space-y-2 p-4 rounded-lg border ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                      }`}>
                      {/* Prompt */}
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className={`text-xs font-medium ${isDarkMode ? "text-blue-400" : "text-blue-600"
                            }`}>
                            Prompt
                          </div>
                          <div className="flex items-center gap-1">
                            {!isEditingPrompt && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    copyToClipboard(turn.prompt, promptId);
                                  }}
                                  className={`p-0.5 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Copy prompt"
                                >
                                  {promptCopied ? (
                                    <MdCheck className="w-3 h-3 text-green-500" />
                                  ) : (
                                    <MdContentCopy className="w-3 h-3" />
                                  )}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleStartEditTurn(index, 'prompt');
                                  }}
                                  className={`p-0.5 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Edit prompt"
                                >
                                  <MdEdit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDeleteTurn(index);
                                  }}
                                  disabled={editedTurns.length <= 1}
                                  className={`p-0.5 rounded flex items-center flex-shrink-0 ${editedTurns.length <= 1
                                    ? "opacity-50 cursor-not-allowed"
                                    : isDarkMode
                                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title={editedTurns.length <= 1 ? "Cannot delete the last turn" : "Delete turn"}
                                >
                                  <MdDelete className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            {needsExpansion && !isEditingPrompt && (
                              <button
                                onClick={() => toggleTurnExpansion(index)}
                                className={`p-1 rounded ${isDarkMode
                                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                  }`}
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? (
                                  <MdExpandLess className="w-3 h-3" />
                                ) : (
                                  <MdExpandMore className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className={`text-sm ${isDarkMode ? "text-gray-200" : "text-gray-800"}`}>
                          {isEditingPrompt ? (
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <textarea
                                  value={editingTurnValue}
                                  onChange={(e) => setEditingTurnValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                      e.preventDefault();
                                      handleSaveTurnEdit(index, 'prompt');
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      handleCancelEditTurn();
                                    }
                                  }}
                                  autoFocus
                                  rows={4}
                                  className={`flex-1 px-2 py-1 rounded border text-sm ${isDarkMode
                                    ? "bg-gray-700 border-gray-600 text-white"
                                    : "bg-white border-gray-300 text-black"
                                    } focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y`}
                                />
                                <button
                                  onClick={() => handleSaveTurnEdit(index, 'prompt')}
                                  disabled={editingTurnValue.trim().length === 0}
                                  className={`p-1 rounded flex items-center flex-shrink-0 ${editingTurnValue.trim().length === 0
                                    ? "opacity-50 cursor-not-allowed"
                                    : isDarkMode
                                      ? "bg-green-600 text-white hover:bg-green-700"
                                      : "bg-green-600 text-white hover:bg-green-700"
                                    }`}
                                  title="Save (Ctrl+Enter)"
                                >
                                  <MdCheck className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={handleCancelEditTurn}
                                  className={`p-1 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Cancel (Esc)"
                                >
                                  <MdClose className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`${needsExpansion && !isExpanded ? "cursor-pointer hover:opacity-80" : ""}`}
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
                              dangerouslySetInnerHTML={{
                                __html: isExpanded
                                  ? markdownToHtml(turn.prompt)
                                  : markdownToHtml(truncateText(turn.prompt))
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Response */}
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className={`text-xs font-medium ${isDarkMode ? "text-green-400" : "text-green-600"
                            }`}>
                            Response
                          </div>
                          {!isEditingResponse && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(turn.response, responseId);
                                }}
                                className={`p-1 rounded flex items-center flex-shrink-0 ${isDarkMode
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
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleStartEditTurn(index, 'response');
                                }}
                                className={`p-0.5 rounded flex items-center flex-shrink-0 ${isDarkMode
                                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                  }`}
                                title="Edit response"
                              >
                                <MdEdit className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className={`text-sm ${isDarkMode ? "text-gray-200" : "text-gray-800"}`}>
                          {isEditingResponse ? (
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <textarea
                                  value={editingTurnValue}
                                  onChange={(e) => setEditingTurnValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                      e.preventDefault();
                                      handleSaveTurnEdit(index, 'response');
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      handleCancelEditTurn();
                                    }
                                  }}
                                  autoFocus
                                  rows={6}
                                  className={`flex-1 px-2 py-1 rounded border text-sm ${isDarkMode
                                    ? "bg-gray-700 border-gray-600 text-white"
                                    : "bg-white border-gray-300 text-black"
                                    } focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y`}
                                />
                                <button
                                  onClick={() => handleSaveTurnEdit(index, 'response')}
                                  disabled={editingTurnValue.trim().length === 0}
                                  className={`p-1 rounded flex items-center flex-shrink-0 ${editingTurnValue.trim().length === 0
                                    ? "opacity-50 cursor-not-allowed"
                                    : isDarkMode
                                      ? "bg-green-600 text-white hover:bg-green-700"
                                      : "bg-green-600 text-white hover:bg-green-700"
                                    }`}
                                  title="Save (Ctrl+Enter)"
                                >
                                  <MdCheck className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={handleCancelEditTurn}
                                  className={`p-1 rounded flex items-center flex-shrink-0 ${isDarkMode
                                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    }`}
                                  title="Cancel (Esc)"
                                >
                                  <MdClose className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`${needsExpansion && !isExpanded ? "cursor-pointer hover:opacity-80" : ""}`}
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
                              dangerouslySetInnerHTML={{
                                __html: isExpanded
                                  ? markdownToHtml(turn.response)
                                  : markdownToHtml(truncateText(turn.response))
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            // Chat list view
            <div className="space-y-2 relative pb-4">
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
                        className={`w-full flex items-center gap-2 p-4 rounded-lg border transition-colors ${isDarkMode
                          ? "bg-gray-800 border-gray-700"
                          : "bg-gray-50 border-gray-200"
                          }`}
                      >
                        <button
                          onClick={() => handleChatClick(chat)}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-2 font-medium mb-1">

                            {chat.title}
                          </div>
                          <div className={`text-xs flex items-center gap-1 ${isDarkMode ? "text-gray-400" : "text-black/60"}`}>
                            {chat.turns.length === 1 && !chat.turns[0].response ? (
                              <MdNote className={`w-3 h-3 ${isDarkMode ? "text-purple-400" : "text-purple-600"}`} />
                            ) : (
                              <MdMessage className={`w-3 h-3 ${isDarkMode ? "text-blue-400" : "text-blue-600"}`} />
                            )}
                            {formatDate(chat.timestamp)}
                            {chat.turns.length === 1 && !chat.turns[0].response ? (
                              " • Note"
                            ) : (
                              ` • ${chat.turns?.length || 0} turn${(chat.turns?.length || 0) !== 1 ? "s" : ""}`
                            )}
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteChat(chat);
                          }}
                          className={`p-0.5 rounded transition-colors flex-shrink-0 ${isDarkMode
                            ? "text-gray-400 hover:text-red-400 hover:bg-gray-700"
                            : "text-gray-500 hover:text-red-600 hover:bg-gray-200"
                            }`}
                          title="Delete chat"
                        >
                          <MdDelete className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {/* Loading overlay for pagination/search */}
                    {(paginationLoading || (searchLoading && chats.length > 0)) && (
                      <div className={`absolute inset-0 bg-black/30 backdrop-blur-sm rounded-lg flex items-center justify-center z-10 ${isDarkMode ? "bg-black/50" : "bg-white/70"
                        }`}>
                        <div className={`px-4 py-2 rounded-lg font-medium ${isDarkMode ? "bg-gray-800 text-white" : "bg-white text-black shadow-lg"
                          }`}>
                          Loading...
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Pagination */}
                  {pagination && pagination.totalPages > 1 && (
                    <div className="pt-4 flex items-center justify-between gap-2 mb-4">
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
                        className={`px-3 py-1.5 rounded text-sm font-medium ${paginationLoading || currentPage === 0
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
                          className={`w-12 px-1.5 py-1 text-center text-sm rounded border ${paginationLoading || searchLoading
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                            } ${isDarkMode
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
                            className={`px-2 py-1 rounded text-xs font-medium ${paginationLoading || searchLoading
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
                        className={`px-3 py-1.5 rounded text-sm font-medium ${paginationLoading || searchLoading || !pagination.hasMore
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
                  {userInfo?.message && (
                    <div className={`mt-4 p-3 rounded-lg border ${userInfo.messageType === 'success'
                      ? isDarkMode
                        ? "bg-green-900/30 border-green-700/50 text-green-200"
                        : "bg-green-50 border-green-200 text-green-800"
                      : userInfo.messageType === 'error'
                        ? isDarkMode
                          ? "bg-red-900/30 border-red-700/50 text-red-200"
                          : "bg-red-50 border-red-200 text-red-800"
                        : userInfo.messageType === 'alert'
                          ? isDarkMode
                            ? "bg-yellow-900/30 border-yellow-700/50 text-yellow-200"
                            : "bg-yellow-50 border-yellow-200 text-yellow-800"
                          : isDarkMode
                            ? "bg-gray-800/50 border-gray-700 text-gray-300"
                            : "bg-gray-50 border-gray-200 text-gray-700"
                      }`}>
                      <div
                        className="text-sm"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(userInfo.message) }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>}

        {/* Debug Panel - Toggle with Ctrl+Shift+D */}
        {showDebug && (
          <div className={`mt-4 pt-4 border-t ${isDarkMode ? "border-gray-700" : "border-black/5"
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
              className={`w-full text-left px-2 py-1 rounded text-xs font-medium ${isDarkMode
                ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
            >
              {showDebug ? "▼" : "▶"} Debug Panel ({debugLogs.length} logs)
              <span className="ml-2 text-xs opacity-60">(Ctrl+Shift+D to toggle)</span>
            </button>
            {showDebug && (
              <div className={`mt-2 p-3 rounded text-xs font-mono max-h-64 overflow-y-auto ${isDarkMode ? "bg-gray-950 text-gray-300" : "bg-gray-50 text-gray-800"
                }`}>
                <div className={`mb-3 pb-3 border-b ${isDarkMode ? "border-gray-700" : "border-gray-300"
                  }`}>
                  <div className="font-semibold mb-1">Widget Version: v{WIDGET_VERSION}</div>
                  <div className={`text-xs mt-1 ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}>Mode: MCP App</div>
                </div>
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
            <div className={`w-full max-w-2xl rounded-lg ${isDarkMode ? "bg-gray-800" : "bg-white"
              } p-6 max-h-[90vh] flex flex-col`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-semibold ${isDarkMode ? "text-white" : "text-black"
                  }`}>
                  Save Chat Manually
                </h2>
                <button
                  onClick={handleCloseManualSaveModal}
                  className={`p-1 rounded ${isDarkMode
                    ? "hover:bg-gray-700 text-gray-300"
                    : "hover:bg-gray-100 text-gray-600"
                    }`}
                >
                  <MdClose className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2">
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? "text-gray-300" : "text-gray-700"
                      }`}>
                      Title (optional)
                    </label>
                    <input
                      type="text"
                      value={manualSaveTitle}
                      onChange={(e) => setManualSaveTitle(e.target.value)}
                      placeholder="manual"
                      className={`w-full px-3 py-2 rounded-lg border ${isDarkMode
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        : "bg-white border-gray-300 text-black placeholder-gray-500"
                        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    />
                  </div>

                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? "text-gray-300" : "text-gray-700"
                      }`}>
                      Paste Chat Conversation or Note
                    </label>
                    <textarea
                      value={manualSaveContent}
                      onChange={(e) => {
                        setManualSaveContent(e.target.value);
                        // Clear HTML when user manually edits
                        if (manualSaveHtml) {
                          setManualSaveHtml("");
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const clipboardData = e.clipboardData || window.clipboardData;

                        // Try to get HTML content first
                        const html = clipboardData.getData("text/html");
                        const plainText = clipboardData.getData("text/plain");

                        if (html && html.trim().length > 0) {
                          // HTML found - store it and display plain text in textarea
                          setManualSaveHtml(html);
                          setManualSaveContent(plainText || html.replace(/<[^>]*>/g, "").trim());
                          addLog("Pasted HTML content", { htmlLength: html.length, textLength: plainText.length });
                        } else if (plainText) {
                          // Only plain text available
                          setManualSaveHtml("");
                          setManualSaveContent(plainText);
                        }
                      }}
                      placeholder="Paste the copied conversation here..."
                      rows={2}
                      className={`w-full px-3 py-2 rounded-lg border font-mono text-sm ${isDarkMode
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        : "bg-white border-gray-300 text-black placeholder-gray-500"
                        } focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y`}
                    />
                  </div>

                  {manualSaveError && (
                    <div className={`p-3 rounded-lg ${isDarkMode ? "bg-red-900/30 border border-red-700" : "bg-red-50 border border-red-200"
                      }`}>
                      <p className={`text-sm ${isDarkMode ? "text-red-300" : "text-red-700"
                        }`}>
                        {manualSaveError}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCloseManualSaveModal}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDarkMode
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
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isSaving || !manualSaveContent.trim()
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

        {/* Error message at bottom */}
        {error && (
          <div className={`mt-4 p-3 rounded-lg border ${isDarkMode
            ? "bg-red-900/30 border-red-700/50 text-red-300"
            : "bg-red-50 border-red-200 text-red-700"
            }`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 text-sm">
                <div className="font-medium mb-1">Error</div>
                <div>{error}</div>
              </div>
              <button
                onClick={() => setError(null)}
                className={`p-1 rounded flex-shrink-0 ${isDarkMode
                  ? "text-red-300 hover:text-red-200 hover:bg-red-800/50"
                  : "text-red-700 hover:text-red-800 hover:bg-red-100"
                  }`}
                title="Dismiss error"
              >
                <MdClose className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Help Icon - Absolute bottom right on main panel */}
        {!showHelp && (
          <button
            onClick={handleHelpClick}
            className={`absolute bottom-4 right-4 w-6 h-6 mt-4 flex items-center justify-center transition-colors z-50 ${isDarkMode
              ? "text-gray-400 hover:text-gray-300"
              : "text-gray-500 hover:text-gray-700"
              }`}
            title="Help"
          >
            <MdHelp className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Help Area - Fixed bottom */}
      {showHelp && (
        <div className={` h-fullfixed top-0 left-4 right-4  rounded-t-lg z-40 flex flex-col ${isDarkMode
          ? "bg-gray-900  text-white "
          : "bg-gray-200  text-black"
          }`} style={{ maxHeight: 'calc(100vh)' }}>
          <div className={`flex items-center justify-between px-6 py-3 border-b dark:border-gray-800 border-gray-300 flex-shrink-0            }`} style={{ minHeight: '40px', height: '40px' }}>
            <h3 className={`text-lg font-semibold ${isDarkMode ? "text-white" : "text-black"
              }`}>
              Help
            </h3>
            <button
              onClick={() => setShowHelp(false)}
              className={`p-1.5 rounded flex-shrink-0 ${isDarkMode
                ? "text-white hover:bg-gray-700"
                : "text-black hover:bg-gray-200"
                }`}
              title="Close help"
            >
              <MdClose className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 px-6 pt-6 relative" style={{ paddingRight: 'calc(1.5rem + 8px)', maxHeight: '100%' }}>
            {helpTextLoading && (
              <div className={`absolute inset-0 flex items-center justify-center ${isDarkMode ? "bg-gray-900/80" : "bg-gray-200/80"}`}>
                <div className={`text-sm ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Loading...
                </div>
              </div>
            )}
            {helpText ? (
              <div
                className={`text-sm ${isDarkMode ? "text-gray-300" : "text-gray-700"
                  }`}
                dangerouslySetInnerHTML={{ __html: markdownToHtml(helpText) }}
              />
            ) : !helpTextLoading ? (
              <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
                No help text available.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("chat-vault-root")).render(<App />);
