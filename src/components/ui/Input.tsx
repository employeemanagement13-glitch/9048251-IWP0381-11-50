import * as React from "react"

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={[
        "flex h-[1.875rem] w-full rounded-[var(--radius-sm)]",
        "border border-[var(--border)] bg-white",
        "px-2.5 py-1 text-[0.71875rem] text-[var(--text-primary)]",
        "placeholder:text-[var(--text-muted)]",
        "shadow-[var(--shadow-sm)]",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] focus-visible:border-[var(--primary)]",
        "file:border-0 file:bg-transparent file:text-xs file:font-medium",
        "disabled:cursor-not-allowed disabled:opacity-50",
        type === "date"
          ? "pr-1.5 pl-2.5 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 hover:[&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:p-0.5 [&::-webkit-calendar-picker-indicator]:ml-1"
          : "",
        className ?? "",
      ].join(" ")}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }

