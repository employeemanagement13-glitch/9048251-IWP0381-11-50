"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Loader2 } from "lucide-react";
import { updateCreditInvoicesLimit, updateCcbplRunningTotalLimit, updateGuaranteedAmount } from "@/lib/actions/settings";

interface Props {
  initialSettings: any;
  initialAlerts?: any;
  globalAlerts?: any[];
}

export function SettingsClient({ initialSettings }: Props) {
  const router = useRouter();
  const [isPendingCredit, startTransitionCredit] = useTransition();

  const [creditInvoicesLimit, setCreditInvoicesLimit] = useState(
    String(initialSettings?.credit_invoices_limit ?? "1")
  );

  const [ccbplLimit, setCcbplLimit] = useState(
    String(initialSettings?.ccbpl_running_total_limit ?? initialSettings?.ccbpl_deposit_floor ?? "40000000")
  );
  const [isPendingLimit, startTransitionLimit] = useTransition();

  const [guaranteedAmount, setGuaranteedAmount] = useState(
    String(initialSettings?.guaranteed_amount ?? "0")
  );
  const [isPendingGuarantee, startTransitionGuarantee] = useTransition();

  const handleSaveCreditLimit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(creditInvoicesLimit, 10);
    if (isNaN(val) || val < 1) {
      alert("Credit Invoices Limit must be at least 1.");
      return;
    }
    startTransitionCredit(async () => {
      try {
        await updateCreditInvoicesLimit(val);
        router.refresh();
        alert("Credit Invoices Limit updated successfully.");
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSaveCcbplLimit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(ccbplLimit);
    if (isNaN(val) || val < 0) {
      alert("CCBPL Running Total Limit must be 0 or a positive number.");
      return;
    }
    startTransitionLimit(async () => {
      try {
        await updateCcbplRunningTotalLimit(val);
        router.refresh();
        alert("CCBPL Running Total Limit updated successfully.");
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSaveGuaranteedAmount = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(guaranteedAmount);
    if (isNaN(val) || val < 0) {
      alert("Guaranteed Amount must be 0 or a positive number.");
      return;
    }
    startTransitionGuarantee(async () => {
      try {
        await updateGuaranteedAmount(val);
        router.refresh();
        alert("Guaranteed Amount updated successfully.");
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveCreditLimit} className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-md font-bold text-zinc-900">Credit Invoices Limit</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Global limit applied across all shops (default = 1). Governs when any credit outlet automatically becomes overdue.
            </p>
          </div>
          <Badge variant="default" className="text-xs">Global Policy</Badge>
        </div>

        <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="font-semibold text-zinc-800 text-sm">
              Allowed Unpaid Invoices
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              If an outlet exceeds this number of unpaid credit invoices (e.g. limit is {creditInvoicesLimit || 1}, and {Number(creditInvoicesLimit || 1) + 1} or more invoices are generated while previous remain unpaid), the outlet is automatically marked as <span className="text-red-600 font-semibold">OVERDUE</span> and a real-time alert is generated in Tab 7 Alerts.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">Limit:</span>
            <Input
              type="number"
              min="1"
              step="1"
              value={creditInvoicesLimit}
              onChange={(e) => setCreditInvoicesLimit(e.target.value)}
              className="w-24 text-center font-bold text-base"
              required
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPendingCredit} className="flex items-center gap-1.5">
            {isPendingCredit && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{isPendingCredit ? "Saving Limit..." : "Save Credit Invoices Limit"}</span>
          </Button>
        </div>
      </form>

      {/* CCBPL Running Total Limit */}
      <form onSubmit={handleSaveCcbplLimit} className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-md font-bold text-zinc-900">CCBPL Running Total Limit</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Contractual running total credit limit for CCBPL. Automatically updates Limit and Remaining in the Vendor Account Ledger.
            </p>
          </div>
          <Badge variant="default" className="text-xs">Financial</Badge>
        </div>

        <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="font-semibold text-zinc-800 text-sm">Running Total Limit (Rs.)</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Total credit limit allocated by CCBPL. Any update saves the effective date so past filtered ledger records preserve their historical limit.
              Default is <span className="font-semibold">Rs. 40,000,000</span>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">Rs.</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={ccbplLimit}
              onChange={(e) => setCcbplLimit(e.target.value)}
              className="w-44 text-right font-bold text-base"
              required
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPendingLimit} className="flex items-center gap-1.5">
            {isPendingLimit && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{isPendingLimit ? "Saving Limit..." : "Save CCBPL Running Total Limit"}</span>
          </Button>
        </div>
      </form>

      {/* Guaranteed Amount */}
      <form onSubmit={handleSaveGuaranteedAmount} className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-md font-bold text-zinc-900">Guaranteed Amount</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Guaranteed amount provided to CCBPL (security deposit / bank guarantee). Governs CCBPL Trade Payable in the Balance Sheet.
            </p>
          </div>
          <Badge variant="default" className="text-xs">Financial</Badge>
        </div>

        <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="font-semibold text-zinc-800 text-sm">Guaranteed Amount (Rs.)</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Set by distributor. The Balance Sheet computes <span className="font-semibold text-zinc-700">CCBPL Trade Payable = Used (from CCBPL ledger) − Guarantee</span>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">Rs.</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={guaranteedAmount}
              onChange={(e) => setGuaranteedAmount(e.target.value)}
              className="w-44 text-right font-bold text-base"
              required
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPendingGuarantee} className="flex items-center gap-1.5">
            {isPendingGuarantee && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{isPendingGuarantee ? "Saving Guarantee..." : "Save Guaranteed Amount"}</span>
          </Button>
        </div>
      </form>
    </div>
  );
}