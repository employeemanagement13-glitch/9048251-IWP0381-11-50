"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

interface Option {
  value: string;
  label: string;
  sub?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  required?: boolean;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  closeOnClickOutside?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "— Select —",
  searchPlaceholder = "Search...",
  required = false,
  className = "",
  buttonClassName,
  disabled = false,
  closeOnClickOutside = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        (o.label || "").toLowerCase().includes(q) ||
        (o.sub && String(o.sub).toLowerCase().includes(q))
    );
  }, [options, query]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const scale = rootPx / 16;
    const viewportWidth  = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dropdownMaxH   = 260 * scale;
    const minW           = 240 * scale;
    const edge           = 8 * scale;
    const gap            = 2 * scale;
    const panelWidth     = Math.max(rect.width, minW);
    const spaceBelow     = viewportHeight - rect.bottom;
    const rawLeft        = rect.left;
    const clampedLeft    = Math.min(rawLeft, viewportWidth - panelWidth - edge);
    const finalLeft      = Math.max(edge, clampedLeft);
    setDropdownStyle({
      position: "fixed",
      top: spaceBelow >= dropdownMaxH ? rect.bottom + gap : rect.top - dropdownMaxH - gap,
      left: finalLeft,
      width: panelWidth,
      zIndex: 9999,
    });
  }, [open]);

  useEffect(() => {
    const isClickOnScrollbar = (e: MouseEvent): boolean => {
      if (
        document.documentElement &&
        (e.clientX >= document.documentElement.clientWidth ||
         e.clientY >= document.documentElement.clientHeight)
      ) {
        return true;
      }
      const target = e.target as HTMLElement;
      if (!target || !target.getBoundingClientRect) return false;
      const rect = target.getBoundingClientRect();
      const hasVScroll = target.offsetWidth > target.clientWidth;
      const hasHScroll = target.offsetHeight > target.clientHeight;
      if (hasVScroll && e.clientX >= rect.left + target.clientWidth && e.clientX <= rect.right + 4) {
        return true;
      }
      if (hasHScroll && e.clientY >= rect.top + target.clientHeight && e.clientY <= rect.bottom + 4) {
        return true;
      }
      return false;
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (!closeOnClickOutside) return;
      if (isClickOnScrollbar(e)) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeOnClickOutside]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev);
            setQuery("");
          }
        }}
        className={`w-full ${buttonClassName ?? "h-9 text-sm px-3"} flex items-center justify-between rounded-md border bg-white text-left transition-colors ${
          disabled
            ? "border-zinc-200 text-zinc-400 cursor-not-allowed bg-zinc-50"
            : "border-zinc-300 text-zinc-800 cursor-pointer hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500"
        }`}
      >
        <span className={`truncate flex-1 ${!selected ? "text-zinc-400" : ""}`}>
          {selected ? (
            <span>
              {selected.sub && (
                <span className="font-mono text-zinc-500 mr-1.5 text-xs">[{selected.sub}]</span>
              )}
              {selected.label}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {value && !disabled && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }}
              className="text-zinc-400 hover:text-zinc-600 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {required && (
        <select
          tabIndex={-1}
          value={value}
          onChange={() => {}}
          required={required}
          className="sr-only"
          aria-hidden="true"
        >
          <option value=""></option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {open && (
        <div
          style={dropdownStyle}
          className="bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-zinc-100">
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-50 border border-zinc-200">
              <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 text-xs bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-zinc-50">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-zinc-400 text-center">No results found</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between hover:bg-red-50/60 transition-colors ${
                    value === o.value
                      ? "bg-red-50 text-red-800 font-semibold"
                      : "text-zinc-800"
                  }`}
                >
                  <span>
                    {o.sub && (
                      <span className="font-mono text-zinc-500 mr-1.5">[{o.sub}]</span>
                    )}
                    {o.label}
                  </span>
                  {value === o.value && <Check className="h-3.5 w-3.5 text-red-600 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
