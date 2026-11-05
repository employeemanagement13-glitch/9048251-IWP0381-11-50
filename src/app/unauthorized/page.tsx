"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

function UnauthorizedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "access_denied";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const messages: Record<string, { title: string; description: string }> = {
    no_tenant: {
      title: "No Account",
      description: "Your account is not assigned to any distribution. Please contact Aroxes team to get access.",
    },
    tenant_disabled: {
      title: "Account Disabled",
      description: "Your distribution account has been disabled. Please contact Aroxes team or clear your dues.",
    },
    access_denied: {
      title: "Access Denied",
      description: "You do not have permission to access Distroline. Please contact Aroxes team if you believe this is an error.",
    },
  };

  const message = messages[reason] || messages.access_denied;
  const showUserButton = reason === "no_tenant" || reason === "access_denied";

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-slate-50">
      {showUserButton && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          {mounted ? (
            <UserButton />
          ) : (
            <div className="w-7 h-7 rounded-full bg-zinc-200/60" />
          )}
        </div>
      )}
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {message.title}
          </h1>

          {/* Description */}
          <p className="text-slate-600 mb-6">
            {message.description}
          </p>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={() => router.push("/")}
              className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
            >
              Go to Home
            </button>
          </div>

          {/* Support Info */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-sm text-slate-500">
              Need help? Contact your platform administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50"><p>Loading...</p></div>}>
      <UnauthorizedContent />
    </Suspense>
  );
}

