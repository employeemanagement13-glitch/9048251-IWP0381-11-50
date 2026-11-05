import * as React from "react"

interface SectionCardProps {
  /** Section heading shown top-left */
  title: string
  /** Optional pipe-separated sub-label, e.g. "Attendance" in "Lectures | Attendance" */
  subtitle?: string
  /** Optional controls shown top-right (search bars, filter buttons, action buttons) */
  toolbar?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * SectionCard — reusable white card with a consistent header bar.
 *
 * DRY: replaces the repeated pattern of
 *   <div className="bg-white rounded-lg border ...">
 *     <div className="flex justify-between ...">
 *       <h2>Title</h2>
 *       <controls />
 *     </div>
 *     {children}
 *   </div>
 *
 * Usage:
 *   <SectionCard title="Lectures" subtitle="Attendance" toolbar={<SearchBar ... />}>
 *     <Table .../>
 *   </SectionCard>
 */
export function SectionCard({
  title,
  subtitle,
  toolbar,
  children,
  className = "",
}: SectionCardProps) {
  return (
    <div
      className={[
        "bg-white rounded-[var(--radius)] border border-[var(--border)]",
        "shadow-[var(--shadow)] overflow-hidden fade-in",
        className,
      ].join(" ")}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-light)]">
        <h2 className="text-[0.75rem] font-semibold text-[var(--text-primary)] leading-none">
          {title}
          {subtitle && (
            <>
              <span className="mx-1.5 text-[var(--border)]">|</span>
              <span className="text-[var(--text-secondary)] font-normal">{subtitle}</span>
            </>
          )}
        </h2>
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div>{children}</div>
    </div>
  )
}

