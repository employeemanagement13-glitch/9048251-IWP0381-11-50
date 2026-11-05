import * as React from "react"
import { Table2 } from "lucide-react"

/* ─── Table Shell ────────────────────────────────────────────────────── */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="w-full overflow-auto bg-white rounded-[var(--radius)] border border-[var(--border)]">
      <table
        ref={ref}
        className={`w-full caption-bottom text-[0.71875rem] ${className ?? ""}`}
        {...props}
      />
    </div>
  )
)
Table.displayName = "Table"

/* ─── Header ─────────────────────────────────────────────────────────── */
const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={`border-b border-[var(--border)] bg-[#FAFAFA] [&_tr]:border-0 ${className ?? ""}`}
      {...props}
    />
  )
)
TableHeader.displayName = "TableHeader"

/* ─── Body ───────────────────────────────────────────────────────────── */
const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={`[&_tr:last-child]:border-0 ${className ?? ""}`}
      {...props}
    />
  )
)
TableBody.displayName = "TableBody"

/* ─── Row ────────────────────────────────────────────────────────────── */
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={`border-b border-[var(--border-light)] transition-colors hover:bg-[var(--surface-hover)] ${className ?? ""}`}
      {...props}
    />
  )
)
TableRow.displayName = "TableRow"

/* ─── Head Cell ──────────────────────────────────────────────────────── */
const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, children, ...props }, ref) => {
    const content =
      typeof children === "string" || typeof children === "number"
        ? (
          <span className="inline-flex items-center gap-1.5">
            <Table2 className="h-3 w-3 text-[#e31e2a]" />
            <span>{children}</span>
          </span>
        )
        : children

    return (
      <th
        ref={ref}
        className={`h-8 px-3 text-left align-middle text-[0.65625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide has-[[role=checkbox]]:pr-0 ${className ?? ""}`}
        {...props}
      >
        {content}
      </th>
    )
  }
)
TableHead.displayName = "TableHead"

/* ─── Data Cell ──────────────────────────────────────────────────────── */
const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={`px-3 py-2.5 align-middle text-[0.71875rem] text-[var(--text-primary)] has-[[role=checkbox]]:pr-0 ${className ?? ""}`}
      {...props}
    />
  )
)
TableCell.displayName = "TableCell"

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }

