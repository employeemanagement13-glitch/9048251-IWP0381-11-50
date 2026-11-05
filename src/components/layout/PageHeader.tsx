interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

/**
 * PageHeader — consistent section heading for every content page.
 * Shows title + optional subtitle on the left, optional action button on the right.
 */
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 mb-3 sm:mb-4 lg:mb-5 min-w-0">
      <div className="min-w-0">
        <h1 className="text-[0.84375rem] sm:text-[0.90625rem] font-bold text-[var(--text-primary)] leading-snug truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[0.6875rem] text-[var(--text-secondary)] mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 flex flex-wrap items-center gap-1.5 sm:gap-2">{action}</div>}
    </div>
  );
}

