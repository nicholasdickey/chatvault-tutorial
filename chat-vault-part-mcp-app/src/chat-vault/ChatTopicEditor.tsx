import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdAdd, MdClose, MdLabel } from "react-icons/md";
import { TopicCombobox } from "./TopicCombobox.js";
import type { AvailableTopic, Topic } from "./types.js";

const MAX_VISIBLE_CHIPS = 3;

export interface ChatTopicEditorProps {
  chatId: string;
  topics: Topic[];
  options: AvailableTopic[];
  onSave: (chatId: string, topics: Topic[]) => Promise<void>;
  disabled?: boolean;
  isDarkMode?: boolean;
  onOpenOptions?: () => void;
}

export function ChatTopicEditor({
  chatId,
  topics,
  options,
  onSave,
  disabled = false,
  isDarkMode = false,
  onOpenOptions,
}: ChatTopicEditorProps) {
  const popoverId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draftTopics, setDraftTopics] = useState<Topic[]>(topics);
  const [saving, setSaving] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraftTopics(topics);
    }
  }, [topics, editing]);

  useEffect(() => {
    if (!editing) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPopoverPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    };

    updatePosition();
    onOpenOptions?.();

    const onLayoutChange = () => updatePosition();
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      const portal = document.getElementById(`${popoverId}-portal`);
      if (portal?.contains(target)) return;
      setEditing(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [editing, onOpenOptions, popoverId]);

  const chipClass = isDarkMode
    ? "bg-blue-900/40 text-blue-100 border-blue-800"
    : "bg-blue-50 text-blue-800 border-blue-200";

  const visibleTopics = topics.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = Math.max(0, topics.length - MAX_VISIBLE_CHIPS);

  const handleDraftChange = async (next: Topic[]) => {
    setDraftTopics(next);
    if (saving) return;

    setSaving(true);
    try {
      await onSave(chatId, next);
    } finally {
      setSaving(false);
    }
  };

  const popover =
    editing && !disabled ? (
      <div
        className={`rounded-lg border p-3 shadow-lg ${
          isDarkMode
            ? "bg-gray-800 border-gray-600 text-white"
            : "bg-white border-gray-200 text-black"
        }`}
        style={
          popoverPosition
            ? {
                position: "fixed",
                top: popoverPosition.top,
                left: popoverPosition.left,
                width: popoverPosition.width,
                zIndex: 10000,
              }
            : { display: "none" }
        }
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-medium opacity-80">Edit topics</span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded p-0.5 opacity-70 hover:opacity-100"
            aria-label="Close topic editor"
          >
            <MdClose className="w-4 h-4" />
          </button>
        </div>
        <TopicCombobox
          selected={draftTopics}
          options={options}
          onChange={handleDraftChange}
          allowCreate
          maxItems={5}
          disabled={disabled || saving}
          placeholder="Add a topic…"
          isDarkMode={isDarkMode}
        />
      </div>
    ) : null;

  return (
    <div
      ref={anchorRef}
      className="mt-1.5 flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {visibleTopics.map((topic) => (
        <span
          key={topic.id}
          className={`inline-flex max-w-[120px] items-center px-2 py-0.5 rounded-full border text-[11px] ${chipClass}`}
        >
          <span className="truncate">{topic.name}</span>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${
            isDarkMode ? "text-gray-400 border-gray-600" : "text-gray-600 border-gray-300"
          }`}
        >
          +{hiddenCount}
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => setEditing((open) => !open)}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[11px] transition-colors ${
          isDarkMode
            ? "border-gray-600 text-gray-300 hover:bg-gray-700"
            : "border-gray-300 text-gray-600 hover:bg-gray-100"
        } ${disabled || saving ? "opacity-50 cursor-not-allowed" : ""}`}
        title="Edit topics"
        aria-label="Edit topics"
      >
        {topics.length === 0 ? (
          <>
            <MdLabel className="w-3 h-3" />
            <span>Topic</span>
          </>
        ) : (
          <MdAdd className="w-3 h-3" />
        )}
      </button>

      {popover
        ? createPortal(
            <div id={`${popoverId}-portal`}>{popover}</div>,
            document.body,
          )
        : null}
    </div>
  );
}
