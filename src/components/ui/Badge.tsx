import * as React from "react"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "orange"
}

const VARIANT_STYLES: Record<string, string> = {
  default:     "bg-[var(--primary-light)] text-[var(--primary)]",
  orange:      "bg-[var(--primary)] text-white",
  secondary:   "bg-gray-100 text-[var(--text-secondary)]",
  destructive: "bg-rose-50 text-rose-600",
  outline:     "border border-[var(--border)] bg-white text-[var(--text-primary)]",
  success:     "bg-emerald-50 text-emerald-600",
  warning:     "bg-amber-50 text-amber-600",
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5",
        "text-[0.625rem] font-semibold tracking-wide",
        "transition-colors",
        VARIANT_STYLES[variant],
        className ?? "",
      ].join(" ")}
      {...props}
    />
  )
}

