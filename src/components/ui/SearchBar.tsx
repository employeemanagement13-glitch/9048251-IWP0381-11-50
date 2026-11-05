"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { Input } from "./Input"
import { Button } from "./Button"

export interface FilterButton {
  label: string
  onClick?: () => void
  active?: boolean
}

interface SearchBarProps {
  /** Controlled search value */
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  /** Optional filter buttons shown after the search input */
  filters?: FilterButton[]
  className?: string
}

/**
 * SearchBar — reusable search input + filter button group.
 *
 * DRY: extracts the "Search | Filter | Filter" toolbar pattern
 * that appears on every table-heavy page in the system.
 *
 * Usage:
 *   <SearchBar
 *     placeholder="Search Requests"
 *     value={query}
 *     onChange={setQuery}
 *     filters={[
 *       { label: "Section", onClick: () => ... },
 *       { label: "Semester", onClick: () => ... },
 *     ]}
 *   />
 */
export function SearchBar({
  value,
  onChange,
  placeholder = "Search…",
  filters = [],
  className = "",
}: SearchBarProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#e31e2a] pointer-events-none h-[0.75rem] w-[0.75rem]"
        />
        <Input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="pl-7 w-[11.25rem]"
        />
      </div>

      {/* Filter Buttons */}
      {filters.map((f) => (
        <Button
          key={f.label}
          variant={f.active ? "default" : "outline"}
          size="sm"
          onClick={f.onClick}
          type="button"
        >
          {f.label}
        </Button>
      ))}
    </div>
  )
}

