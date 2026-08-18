import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import type { AvailableTopic, Topic } from "./types.js";

export interface TopicComboboxProps {
  selected: Topic[];
  options: AvailableTopic[];
  onChange: (topics: Topic[]) => void;
  allowCreate?: boolean;
  maxItems?: number;
  disabled?: boolean;
  placeholder?: string;
  isDarkMode?: boolean;
  /** Match search input padding, height, and focus ring in the list filter bar */
  matchSearchInput?: boolean;
  leadingIcon?: ReactNode;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

export function TopicCombobox({
  selected,
  options,
  onChange,
  allowCreate = false,
  maxItems = 5,
  disabled = false,
  placeholder = "Filter by topic…",
  isDarkMode = false,
  matchSearchInput = false,
  leadingIcon,
}: TopicComboboxProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(
    null,
  );

  const selectedIds = useMemo(() => new Set(selected.map((t) => t.id)), [selected]);

  const filteredOptions = useMemo(() => {
    const needle = normalize(inputValue);
    return options
      .filter((opt) => !selectedIds.has(opt.id))
      .filter((opt) => !needle || normalize(opt.name).includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inputValue, options, selectedIds]);

  const exactMatch = useMemo(() => {
    const needle = normalize(inputValue);
    if (!needle) return null;
    return options.find((opt) => normalize(opt.name) === needle) ?? null;
  }, [inputValue, options]);

  const showCreateRow =
    allowCreate &&
    inputValue.trim().length > 0 &&
    !exactMatch &&
    !selected.some((t) => normalize(t.name) === normalize(inputValue));

  const dropdownItems = useMemo(() => {
    const items: Array<
      | { type: "option"; topic: AvailableTopic }
      | { type: "create"; label: string }
    > = filteredOptions.map((topic) => ({ type: "option" as const, topic }));
    if (showCreateRow) {
      items.push({ type: "create", label: inputValue.trim() });
    }
    return items;
  }, [filteredOptions, showCreateRow, inputValue]);

  const updateDropdownPosition = () => {
    const anchor = rootRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setDropdownPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    const onLayoutChange = () => updateDropdownPosition();
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);
    return () => {
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [open, inputValue, selected.length, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      const portal = document.getElementById(`${listboxId}-portal`);
      if (portal?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, listboxId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [inputValue, open]);

  const canAddMore = selected.length < maxItems;

  const addTopic = (topic: Topic) => {
    if (!canAddMore || selectedIds.has(topic.id)) return;
    onChange([...selected, topic]);
    setInputValue("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeTopic = (topicId: string) => {
    onChange(selected.filter((t) => t.id !== topicId));
    inputRef.current?.focus();
  };

  const handleSelectActive = () => {
    const item = dropdownItems[activeIndex];
    if (!item) return;
    if (item.type === "option") {
      addTopic({ id: item.topic.id, name: item.topic.name });
      return;
    }
    if (item.type === "create") {
      addTopic({ id: `new:${normalize(item.label)}`, name: item.label });
    }
  };

  const chipClass = isDarkMode
    ? "bg-blue-900/50 text-blue-100 border-blue-700"
    : "bg-blue-50 text-blue-800 border-blue-200";
  const containerClass = isDarkMode
    ? "bg-gray-800 border-gray-600"
    : "bg-white border-gray-300";
  const containerPadding = matchSearchInput ? "px-3 py-2" : "px-2 py-1.5";
  const containerMinHeight = matchSearchInput ? "min-h-[40px]" : "min-h-[38px]";
  const containerFocus = matchSearchInput
    ? "focus-within:ring-2 focus-within:ring-blue-500 focus-within:outline-none"
    : "";
  const dropdownClass = isDarkMode
    ? "bg-gray-800 border-gray-600 text-white"
    : "bg-white border-gray-200 text-black shadow-lg";

  const dropdown =
    open && !disabled ? (
      <ul
        id={listboxId}
        role="listbox"
        className={`max-h-48 overflow-y-auto rounded-lg border ${dropdownClass}`}
        style={
          dropdownPosition
            ? {
                position: "fixed",
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                width: dropdownPosition.width,
                zIndex: 10000,
              }
            : { display: "none" }
        }
      >
        {dropdownItems.length === 0 ? (
          <li
            className={`px-3 py-2 text-sm ${
              isDarkMode ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {options.length === 0
              ? "No topics yet"
              : "No matching topics"}
          </li>
        ) : (
          dropdownItems.map((item, index) => {
            const isActive = index === activeIndex;
            if (item.type === "create") {
              return (
                <li key={`create-${item.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`w-full text-left px-3 py-2 text-sm ${
                      isActive
                        ? isDarkMode
                          ? "bg-gray-700"
                          : "bg-blue-50"
                        : ""
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() =>
                      addTopic({ id: `new:${normalize(item.label)}`, name: item.label })
                    }
                  >
                    Create &quot;{item.label}&quot;
                  </button>
                </li>
              );
            }

            const highlightExact =
              inputValue.trim().length > 0 &&
              normalize(item.topic.name) === normalize(inputValue);

            return (
              <li key={item.topic.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                    isActive
                      ? isDarkMode
                        ? "bg-gray-700"
                        : "bg-blue-50"
                      : ""
                  } ${highlightExact ? "font-medium" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() =>
                    addTopic({ id: item.topic.id, name: item.topic.name })
                  }
                >
                  <span className="truncate">{item.topic.name}</span>
                  {item.topic.chatCount != null && (
                    <span
                      className={`text-xs shrink-0 ${
                        isDarkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {item.topic.chatCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className="relative w-full">
      {leadingIcon ? (
        <div
          className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10 ${
            isDarkMode ? "text-gray-400" : "text-gray-500"
          }`}
        >
          {leadingIcon}
        </div>
      ) : null}
      <div
        className={`flex flex-wrap items-center gap-1.5 ${containerMinHeight} ${containerPadding} rounded-lg border text-sm ${containerClass} ${containerFocus} ${
          leadingIcon ? "pl-10" : ""
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {selected.map((topic) => (
          <span
            key={topic.id}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${chipClass}`}
          >
            <span className="max-w-[140px] truncate">{topic.name}</span>
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTopic(topic.id);
                }}
                className="rounded hover:opacity-80"
                aria-label={`Remove topic ${topic.name}`}
              >
                <MdClose className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          disabled={disabled || !canAddMore}
          placeholder={selected.length === 0 ? placeholder : ""}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={`flex-1 min-w-[120px] bg-transparent outline-none text-sm ${
            isDarkMode ? "placeholder-gray-400" : "placeholder-gray-500"
          }`}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              if (dropdownItems.length > 0) {
                setActiveIndex((i) => Math.min(i + 1, dropdownItems.length - 1));
              }
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (dropdownItems.length > 0) {
                setActiveIndex((i) => Math.max(i - 1, 0));
              }
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (open && dropdownItems.length > 0) {
                handleSelectActive();
              } else if (exactMatch) {
                addTopic({ id: exactMatch.id, name: exactMatch.name });
              }
              return;
            }
            if (e.key === "Backspace" && !inputValue && selected.length > 0) {
              const last = selected[selected.length - 1];
              if (last) removeTopic(last.id);
            }
          }}
        />
      </div>

      {dropdown
        ? createPortal(
            <div id={`${listboxId}-portal`}>{dropdown}</div>,
            document.body,
          )
        : null}
    </div>
  );
}
