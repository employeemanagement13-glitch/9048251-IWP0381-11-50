import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  variant?: "default" | "outline" | "ghost" | "link" | "danger"
  size?: "default" | "sm" | "lg" | "icon"
  icon?: React.ReactNode
  iconClassName?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, icon, iconClassName, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    const base =
      "inline-flex items-center justify-center font-medium rounded-[var(--radius-sm)] " +
      "transition-all duration-150 ease-out cursor-pointer " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] " +
      "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]"

    const variants: Record<string, string> = {
      default: "bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--primary-dark)]",
      outline: "border border-[var(--border)] bg-white text-[var(--text-primary)] hover:bg-[var(--surface-hover)] hover:border-gray-300",
      ghost: "text-[var(--text-secondary)] hover:bg-gray-100 hover:text-[var(--text-primary)]",
      link: "text-[var(--primary)] underline-offset-4 hover:underline",
      danger: "bg-rose-500 text-white hover:bg-rose-600 shadow-[var(--shadow-sm)]",
    }

    const sizes: Record<string, string> = {
      default: "h-[1.875rem] px-3 text-[0.6875rem] tracking-wide",
      sm: "h-[1.625rem] px-2.5 text-[0.625rem] rounded-[var(--radius-sm)]",
      lg: "h-[2.125rem] px-4 text-[0.75rem]",
      icon: "h-[1.875rem] w-[1.875rem]",
    }

    return (
      <Comp
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {icon ? (
              <span className={`mr-2 inline-flex items-center justify-center shrink-0 ${iconClassName ?? "text-white"}`}>
                {icon}
              </span>
            ) : null}
            {children}
          </>
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button }

