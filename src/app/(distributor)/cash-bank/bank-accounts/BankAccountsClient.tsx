"use client";

import { useMemo, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import {
  createBankAccount, updateBankAccount, deleteBankAccount, getBankAccountLedger,
  createVendorAccount, updateVendorAccount, deleteVendorAccount, getVendorAccountLedger,
} from "@/lib/actions/bank-accounts";
import { ExportButtons } from "@/components/export/ExportButtons";
import { Loader2 } from "lucide-react";

const BLANK_BANK = { account_title: "", description: "", current_balance: "0", active: true, account_date: new Date().toISOString().split("T")[0] };
const BLANK_VENDOR = { account_title: "", current_balance: "0", active: true, account_date: new Date().toISOString().split("T")[0] };

interface BankAccount {
  id: string;
  bank_name: string;
  account_title: string;
  account_number?: string;
  current_balance: number;
  active: boolean;
  created_at?: string;
  isDummy?: boolean;
}

interface VendorAccount {
  id: string;
  vendor_name: string;
  account_title: string;
  account_number?: string;
  current_balance: number;
  initial_used?: number;
  current_used?: number;
  limit?: number;
  remaining?: number;
  active: boolean;
  created_at?: string;
}

interface LedgerRow {
  id?: string;
  txn_date: string;
  txn_type: string;
  reference?: string;
  amount_in: number;
  amount_out: number;
  limit?: number;
  used?: number;
  remaining?: number;
  running_balance?: number;
  po_no?: string | null;
}

interface BankFormState {
  account_title: string;
  description: string;
  current_balance: string;
  active: boolean;
  account_date: string;
}

interface VendorFormState {
  account_title: string;
  current_balance: string;
  active: boolean;
  account_date: string;
}


function BalancePill({ balance }: { balance: number }) {
  return (
    <span
      className="text-lg font-bold"
      style={{ color: balance >= 0 ? "var(--primary)" : "#dc2626" }}
    >
      Rs. {balance.toLocaleString(undefined, { minimumFractionDigits: 0 })}
    </span>
  );
}

interface Props {
  initialAccounts: BankAccount[];
  initialVendorAccounts?: VendorAccount[];
}

export function BankAccountsClient({ initialAccounts, initialVendorAccounts = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Major Switch State
  const [majorTab, setMajorTab] = useState<"bank" | "vendor">("bank");

  // Bank Accounts State
  const [showBankModal, setShowBankModal] = useState(false);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState<BankFormState>({ ...BLANK_BANK });

  const allBankAccounts = initialAccounts;
  const [activeBankTabId, setActiveBankTabId] = useState<string | null>(allBankAccounts[0]?.id || null);
  const [bankLedgerCache, setBankLedgerCache] = useState<Record<string, LedgerRow[]>>({});
  const [loadingBankLedger, setLoadingBankLedger] = useState(false);

  // Vendor Accounts State
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorFormState>({ ...BLANK_VENDOR });

  const allVendorAccounts = initialVendorAccounts;
  const [activeVendorTabId, setActiveVendorTabId] = useState<string | null>(allVendorAccounts[0]?.id || null);
  const [vendorLedgerCache, setVendorLedgerCache] = useState<Record<string, LedgerRow[]>>({});
  const [loadingVendorLedger, setLoadingVendorLedger] = useState(false);

  // Dates
  const today = new Date().toISOString().split("T")[0];
  const firstDayOfMonth = `${today.substring(0, 8)}01`;
  const [fromDate, setFromDate] = useState(firstDayOfMonth);
  const [toDate, setToDate] = useState(today);
  const [appliedFromDate, setAppliedFromDate] = useState(firstDayOfMonth);
  const [appliedToDate, setAppliedToDate] = useState(today);
  const [isFilteringBank, setIsFilteringBank] = useState(false);
  const [isFilteringVendor, setIsFilteringVendor] = useState(false);
  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);
  const [deletingVendorId, setDeletingVendorId] = useState<string | null>(null);

  const handleLoadBank = async () => {
    setIsFilteringBank(true);
    try {
      if (activeBankTabId && !activeBankAccount?.isDummy) {
        const rows = await getBankAccountLedger(activeBankTabId);
        setBankLedgerCache((prev) => ({ ...prev, [activeBankTabId]: rows }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAppliedFromDate(fromDate);
      setAppliedToDate(toDate);
      setIsFilteringBank(false);
    }
  };

  const handleLoadVendor = async () => {
    setIsFilteringVendor(true);
    try {
      if (activeVendorTabId) {
        const rows = await getVendorAccountLedger(activeVendorTabId);
        setVendorLedgerCache((prev) => ({ ...prev, [activeVendorTabId]: rows }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAppliedFromDate(fromDate);
      setAppliedToDate(toDate);
      setIsFilteringVendor(false);
    }
  };

  const setBank = (k: keyof BankFormState, v: string | boolean) => setBankForm((f) => ({ ...f, [k]: v }));
  const setVendor = (k: keyof VendorFormState, v: string | boolean) => setVendorForm((f) => ({ ...f, [k]: v }));

  const totalBankBalance = allBankAccounts
    .filter((a) => a.active)
    .reduce((s, a) => s + Number(a.current_balance || 0), 0);

  const totalVendorRemaining = allVendorAccounts
    .filter((a) => a.active)
    .reduce((s, a) => s + Number(a.remaining ?? a.current_balance ?? 0), 0);

  const totalVendorUsed = allVendorAccounts
    .filter((a) => a.active)
    .reduce((s, a) => s + Number(a.current_used ?? 0), 0);

  const totalVendorLimit = allVendorAccounts
    .filter((a) => a.active)
    .reduce((s, a) => s + Number(a.limit ?? 40000000), 0);

  // Bank Modals & Handlers
  const openAddBank = () => {
    setEditingBankId(null);
    setBankForm({ ...BLANK_BANK });
    setShowBankModal(true);
  };

  const openEditBank = (acc: BankAccount) => {
    if (acc.isDummy) {
      alert("This is a dummy account preview and cannot be edited.");
      return;
    }
    setEditingBankId(acc.id);
    setBankForm({
      account_title: acc.account_title || "",
      description: (acc as any).description || "",
      current_balance: String(acc.current_balance ?? 0),
      active: acc.active ?? true,
      account_date: ((acc as any).created_at || new Date().toISOString()).split("T")[0],
    });
    setShowBankModal(true);
  };

  const handleDeleteBank = (id: string) => {
    if (!confirm("Are you sure you want to delete this transaction account?")) return;
    setDeletingBankId(id);
    startTransition(async () => {
      try {
        await deleteBankAccount(id);
        if (activeBankTabId === id) setActiveBankTabId(initialAccounts[0]?.id || null);
        router.refresh();
      } catch (error) {
        if (error instanceof Error) alert(error.message);
      } finally {
        setDeletingBankId(null);
      }
    });
  };

  const handleSubmitBank = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload = {
          account_title: bankForm.account_title,
          description: bankForm.description || undefined,
          active: bankForm.active,
          account_date: bankForm.account_date,
          ...(editingBankId ? {} : { current_balance: parseFloat(bankForm.current_balance) || 0 }),
        };
        if (editingBankId) await updateBankAccount(editingBankId, payload);
        else await createBankAccount(payload);
        setShowBankModal(false);
        router.refresh();
      } catch (error) {
        if (error instanceof Error) alert(error.message);
      }
    });
  };

  // Vendor Modals & Handlers
  const openAddVendor = () => {
    setEditingVendorId(null);
    setVendorForm({ ...BLANK_VENDOR });
    setShowVendorModal(true);
  };

  const openEditVendor = (acc: VendorAccount) => {
    setEditingVendorId(acc.id);
    setVendorForm({
      account_title: acc.account_title || "",
      current_balance: String(acc.current_balance ?? 0),
      active: acc.active ?? true,
      account_date: ((acc as any).created_at || new Date().toISOString()).split("T")[0],
    });
    setShowVendorModal(true);
  };

  const handleDeleteVendor = (id: string) => {
    if (!confirm("Are you sure you want to delete this vendor account?")) return;
    setDeletingVendorId(id);
    startTransition(async () => {
      try {
        await deleteVendorAccount(id);
        if (activeVendorTabId === id) setActiveVendorTabId(initialVendorAccounts[0]?.id || null);
        router.refresh();
      } catch (error) {
        if (error instanceof Error) alert(error.message);
      } finally {
        setDeletingVendorId(null);
      }
    });
  };

  const handleSubmitVendor = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const parsedBalance = parseFloat(vendorForm.current_balance);
        const payload = {
          account_title: vendorForm.account_title,
          active: vendorForm.active,
          account_date: vendorForm.account_date,
          ...(editingVendorId ? {} : { current_balance: isNaN(parsedBalance) ? 0 : parsedBalance }),
        };
        if (editingVendorId) await updateVendorAccount(editingVendorId, payload);
        else await createVendorAccount(payload);
        setShowVendorModal(false);
        router.refresh();
      } catch (error) {
        if (error instanceof Error) alert(error.message);
      }
    });
  };

  // Fetch Bank Ledger when active tab changes
  const activeBankAccount = useMemo(
    () => allBankAccounts.find((a) => a.id === activeBankTabId),
    [allBankAccounts, activeBankTabId]
  );

  useEffect(() => {
    if (majorTab !== "bank" || !activeBankTabId || !activeBankAccount || activeBankAccount.isDummy) return;
    if (bankLedgerCache[activeBankTabId]) return;

    const bankAccountId = activeBankTabId;
    let isMounted = true;

    async function loadLedger() {
      setLoadingBankLedger(true);
      try {
        const rows = await getBankAccountLedger(bankAccountId);
        if (isMounted) {
          setBankLedgerCache((prev) => ({ ...prev, [bankAccountId]: rows }));
        }
      } catch {
        // Ignore fetch errors
      } finally {
        if (isMounted) setLoadingBankLedger(false);
      }
    }

    void loadLedger();
    return () => { isMounted = false; };
  }, [majorTab, activeBankTabId, activeBankAccount, bankLedgerCache]);

  // Fetch Vendor Ledger when active tab changes
  const activeVendorAccount = useMemo(
    () => allVendorAccounts.find((a) => a.id === activeVendorTabId),
    [allVendorAccounts, activeVendorTabId]
  );

  useEffect(() => {
    if (majorTab !== "vendor" || !activeVendorTabId || !activeVendorAccount) return;
    if (vendorLedgerCache[activeVendorTabId]) return;

    const vendorAccountId = activeVendorTabId;
    let isMounted = true;

    async function loadLedger() {
      setLoadingVendorLedger(true);
      try {
        const rows = await getVendorAccountLedger(vendorAccountId);
        if (isMounted) {
          setVendorLedgerCache((prev) => ({ ...prev, [vendorAccountId]: rows }));
        }
      } catch {
        // Ignore fetch errors
      } finally {
        if (isMounted) setLoadingVendorLedger(false);
      }
    }

    void loadLedger();
    return () => { isMounted = false; };
  }, [majorTab, activeVendorTabId, activeVendorAccount, vendorLedgerCache]);

  // Filtered rows
  const currentBankLedgerRows = activeBankTabId ? (bankLedgerCache[activeBankTabId] || []) : [];
  const isDummyAccount = activeBankAccount?.isDummy ?? false;
  const activeBankCreationDate = activeBankAccount?.created_at
    ? new Date(activeBankAccount.created_at).toISOString().split("T")[0]
    : null;

  const filteredBankLedgerRows = currentBankLedgerRows.map((row: LedgerRow) => {
    if (row.txn_type === "Sell In Payment") {
      const actualOut = Math.abs(Number(row.amount_out || 0)) + Math.abs(Number(row.amount_in || 0));
      return { ...row, amount_in: 0, amount_out: actualOut };
    }
    return row;
  }).filter((row: LedgerRow) => {
    if (!row.txn_date) return true;
    if (row.txn_type !== "Opening Balance" && activeBankCreationDate && row.txn_date < activeBankCreationDate) {
      return false;
    }
    return row.txn_date >= appliedFromDate && row.txn_date <= appliedToDate;
  });

  const exportBankLedgerData = useMemo(() => {
    return filteredBankLedgerRows.map((row) => ({
      Date: row.txn_date || "—",
      Type: row.txn_type || "—",
      Reference: row.reference || "—",
      "In (Rs.)": row.amount_in ? Number(row.amount_in) : 0,
      "Out (Rs.)": row.amount_out ? Number(row.amount_out) : 0,
      "Running Balance (Rs.)": Number(row.running_balance) || 0,
    }));
  }, [filteredBankLedgerRows]);

  const currentVendorLedgerRows = activeVendorTabId ? (vendorLedgerCache[activeVendorTabId] || []) : [];
  const activeVendorCreationDate = activeVendorAccount?.created_at
    ? new Date(activeVendorAccount.created_at).toISOString().split("T")[0]
    : null;

  const filteredVendorLedgerRows = useMemo(() => {
    if (!currentVendorLedgerRows || currentVendorLedgerRows.length === 0) return [];

    const accountOpeningRow = currentVendorLedgerRows.find(
      (r: any) => r.txn_type === "Opening Used" || r.txn_type === "Opening Balance"
    );
    const creationDate = activeVendorCreationDate || accountOpeningRow?.txn_date || today;

    const txnRows = currentVendorLedgerRows.filter(
      (r: any) => r.txn_type !== "Opening Used" && r.txn_type !== "Opening Balance"
    );

    if (appliedFromDate <= creationDate) {
      const inRangeTxns = txnRows.filter(
        (r: any) => r.txn_date >= appliedFromDate && r.txn_date <= appliedToDate
      );
      return accountOpeningRow ? [accountOpeningRow, ...inRangeTxns] : inRangeTxns;
    }

    const beforeRows = txnRows.filter((r: any) => r.txn_date < appliedFromDate);
    const inRangeTxns = txnRows.filter(
      (r: any) => r.txn_date >= appliedFromDate && r.txn_date <= appliedToDate
    );

    const initialUsed = Number(
      accountOpeningRow?.used ??
      (activeVendorAccount as any)?.initial_used ??
      activeVendorAccount?.current_balance ??
      0
    );
    const priorOut = beforeRows.reduce((sum: number, r: any) => sum + Number(r.amount_out || 0), 0);
    const priorIn = beforeRows.reduce((sum: number, r: any) => sum + Number(r.amount_in || 0), 0);
    const openingUsed = initialUsed + priorOut - priorIn;

    const lastBeforeRow = beforeRows[beforeRows.length - 1];
    const firstInRangeRow = inRangeTxns[0];
    const openingLimit = Number(
      lastBeforeRow?.limit ?? firstInRangeRow?.limit ?? accountOpeningRow?.limit ?? 40000000
    );
    const openingRemaining = openingLimit - openingUsed;

    const openingRow: LedgerRow = {
      txn_date: appliedFromDate,
      txn_type: "Opening Used",
      reference: "—",
      amount_in: 0,
      amount_out: 0,
      limit: openingLimit,
      used: openingUsed,
      remaining: openingRemaining,
      running_balance: openingRemaining,
    };

    return [openingRow, ...inRangeTxns];
  }, [currentVendorLedgerRows, appliedFromDate, appliedToDate, activeVendorCreationDate, activeVendorAccount, today]);

  const exportVendorLedgerData = useMemo(() => {
    return filteredVendorLedgerRows.map((row) => ({
      Date: row.txn_date || "—",
      Type: row.txn_type || "—",
      Reference: row.reference || "—",
      "In (Rs.)": row.amount_in ? Number(row.amount_in) : 0,
      "Out (Rs.)": row.amount_out ? Number(row.amount_out) : 0,
      "Remaining (Rs.)": Number(row.remaining ?? row.running_balance) || 0,
      "Used (Rs.)": Number(row.used) || 0,
      "Limit (Rs.)": Number(row.limit) || 0,
    }));
  }, [filteredVendorLedgerRows]);

  return (
    <div className="space-y-6">
      {/* ── MAJOR SWITCHES ── */}
      <div className="flex border-b border-zinc-200 gap-6">
        <button
          onClick={() => setMajorTab("bank")}
          className={`pb-3 text-base font-bold transition-colors border-b-2 ${
            majorTab === "bank"
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-transparent text-zinc-500 hover:text-zinc-800"
          }`}
        >
          Transaction Accounts
        </button>
        <button
          onClick={() => setMajorTab("vendor")}
          className={`pb-3 text-base font-bold transition-colors border-b-2 ${
            majorTab === "vendor"
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-transparent text-zinc-500 hover:text-zinc-800"
          }`}
        >
          Vendor Accounts
        </button>
      </div>

      {/* ── BANK ACCOUNTS MAJOR TAB ── */}
      {majorTab === "bank" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Total Transaction Account Balance (Active)</p>
              <BalancePill balance={totalBankBalance} />
            </div>
            <Button onClick={openAddBank}>+ Add Transaction Account</Button>
          </div>

          {initialAccounts.length === 0 ? (
            <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200">
              No transaction accounts added yet
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {allBankAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setActiveBankTabId(acc.id)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                      activeBankTabId === acc.id
                        ? "text-white border-transparent shadow-sm"
                        : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                    }`}
                    style={activeBankTabId === acc.id ? { background: "var(--primary)" } : undefined}
                  >
                    {acc.account_title}
                  </button>
                ))}
              </div>

              {activeBankAccount && (
                <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ background: "var(--primary)" }}
                      >
                        {activeBankAccount.bank_name?.charAt(0) || "B"}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-zinc-900 text-lg">{activeBankAccount.account_title}</p>
                          {!activeBankAccount.active && <Badge variant="secondary">Inactive</Badge>}
                        </div>
                        {(activeBankAccount as any).description && (
                          <p className="text-sm text-zinc-500">{(activeBankAccount as any).description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-zinc-500 mb-0.5">Current Balance</p>
                        <BalancePill balance={Number(activeBankAccount.current_balance || 0)} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditBank(activeBankAccount)}>
                          Edit Info
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 min-w-[2rem] flex items-center justify-center"
                          onClick={() => handleDeleteBank(activeBankAccount.id)}
                          disabled={deletingBankId === activeBankAccount.id || isPending}
                        >
                          {deletingBankId === activeBankAccount.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-3 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-4 bg-white">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-zinc-600">From Date</label>
                        <Input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-zinc-600">To Date</label>
                        <Input
                          type="date"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isFilteringBank || loadingBankLedger}
                        onClick={handleLoadBank}
                      >
                        {isFilteringBank ? (
                          <span className="flex items-center">
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            Loading...
                          </span>
                        ) : (
                          "Load"
                        )}
                      </Button>
                    </div>
                    <ExportButtons
                      data={exportBankLedgerData}
                      filename={`${activeBankAccount.bank_name || "bank"}_${activeBankAccount.account_title || "account"}_ledger`}
                    />
                  </div>

                  <div className="overflow-x-auto bg-white flex-1">
                    {loadingBankLedger && !isDummyAccount ? (
                      <div className="text-center text-zinc-400 py-12 text-sm">Loading ledger...</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-zinc-50">
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead className="text-right">In (Rs.)</TableHead>
                            <TableHead className="text-right">Out (Rs.)</TableHead>
                            <TableHead className="text-right">Running Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredBankLedgerRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-zinc-400 py-12">
                                No transactions found for the selected dates.
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredBankLedgerRows.map((row: LedgerRow, i: number) => (
                              <TableRow key={i}>
                                <TableCell>{row.txn_date}</TableCell>
                                <TableCell>
                                  <Badge variant={row.txn_type === "Deposit" ? "success" : "secondary"}>
                                    {row.txn_type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{row.reference || "—"}</TableCell>
                                <TableCell className="text-right text-green-700">
                                  {row.amount_in ? `Rs. ${Number(row.amount_in).toLocaleString()}` : "—"}
                                </TableCell>
                                <TableCell className="text-right text-red-600">
                                  {row.amount_out ? `Rs. ${Number(row.amount_out).toLocaleString()}` : "—"}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  Rs.{" "}
                                  {(Number(row.running_balance) || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── VENDOR ACCOUNTS MAJOR TAB ── */}
      {majorTab === "vendor" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-8">
              <div>
                <p className="text-xs text-zinc-500 mb-1">Total Remaining</p>
                <BalancePill balance={totalVendorRemaining} />
              </div>
              <div className="border-l border-zinc-200 pl-6">
                <p className="text-xs text-zinc-500 mb-1">Total Used</p>
                <span className="text-lg font-bold text-amber-700">
                  Rs. {totalVendorUsed.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                </span>
              </div>
              <div className="border-l border-zinc-200 pl-6">
                <p className="text-xs text-zinc-500 mb-1">Total Limit</p>
                <span className="text-lg font-bold text-zinc-800">
                  Rs. {totalVendorLimit.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                </span>
              </div>
            </div>
            <Button onClick={openAddVendor}>+ Add Vendor Account</Button>
          </div>

          {initialVendorAccounts.length === 0 ? (
            <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200">
              No vendor accounts added yet. Click "+ Add Vendor Account" to create sub accounts for On-Credit tracking.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {allVendorAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setActiveVendorTabId(acc.id)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                      activeVendorTabId === acc.id
                        ? "text-white border-transparent shadow-sm"
                        : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                    }`}
                    style={activeVendorTabId === acc.id ? { background: "var(--primary)" } : undefined}
                  >
                    {acc.account_title}
                  </button>
                ))}
              </div>

              {activeVendorAccount && (
                <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ background: "var(--primary)" }}
                      >
                        {activeVendorAccount.vendor_name?.charAt(0) || "V"}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-zinc-900 text-lg">{activeVendorAccount.account_title}</p>
                          {!activeVendorAccount.active && <Badge variant="secondary">Inactive</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-zinc-500 mb-0.5">Limit</p>
                        <span className="text-lg font-bold text-zinc-800">
                          Rs. {Number(filteredVendorLedgerRows[filteredVendorLedgerRows.length - 1]?.limit ?? activeVendorAccount.limit ?? 40000000).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-zinc-500 mb-0.5">Used</p>
                        <span className="text-lg font-bold text-amber-700">
                          Rs. {Number(filteredVendorLedgerRows[filteredVendorLedgerRows.length - 1]?.used ?? activeVendorAccount.current_used ?? (activeVendorAccount.current_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-zinc-500 mb-0.5">Remaining</p>
                        <BalancePill balance={Number(filteredVendorLedgerRows[filteredVendorLedgerRows.length - 1]?.remaining ?? (activeVendorAccount.remaining ?? activeVendorAccount.current_balance ?? 0))} />
                      </div>
                      <div className="flex flex-col gap-1 ml-2">
                        <Button size="sm" variant="ghost" onClick={() => openEditVendor(activeVendorAccount)}>
                          Edit Info
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDeleteVendor(activeVendorAccount.id)}
                          disabled={isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-3 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-4 bg-white">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-zinc-600">From Date</label>
                        <Input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-zinc-600">To Date</label>
                        <Input
                          type="date"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isFilteringVendor || loadingVendorLedger}
                        onClick={handleLoadVendor}
                      >
                        {isFilteringVendor ? (
                          <span className="flex items-center">
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            Loading...
                          </span>
                        ) : (
                          "Load"
                        )}
                      </Button>
                    </div>
                    <ExportButtons
                      data={exportVendorLedgerData}
                      filename={`${activeVendorAccount.vendor_name || "vendor"}_${activeVendorAccount.account_title || "account"}_ledger`}
                    />
                  </div>

                  <div className="overflow-x-auto bg-white flex-1">
                    {loadingVendorLedger ? (
                      <div className="text-center text-zinc-400 py-12 text-sm">Loading vendor ledger...</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-zinc-50">
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead className="text-right">In (Rs.)</TableHead>
                            <TableHead className="text-right">Out (Rs.)</TableHead>
                            <TableHead className="text-right">Remaining (Rs.)</TableHead>
                            <TableHead className="text-right">Used (Rs.)</TableHead>
                            <TableHead className="text-right">Limit (Rs.)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredVendorLedgerRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center text-zinc-400 py-12">
                                No transactions found for the selected dates.
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredVendorLedgerRows.map((row: LedgerRow, i: number) => (
                              <TableRow key={i}>
                                <TableCell>{row.txn_date}</TableCell>
                                <TableCell className="font-medium text-xs">
                                  <Badge variant={row.txn_type === "Opening Used" ? "secondary" : row.txn_type.includes("Billed") || row.txn_type === "Scheme" ? "success" : "warning"}>
                                    {row.txn_type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{row.reference || "—"}</TableCell>
                                <TableCell className="text-right text-green-700 font-medium">
                                  {row.amount_in ? `Rs. ${Number(row.amount_in).toLocaleString()}` : "—"}
                                </TableCell>
                                <TableCell className="text-right text-red-600 font-medium">
                                  {row.amount_out ? `Rs. ${Number(row.amount_out).toLocaleString()}` : "—"}
                                </TableCell>
                                <TableCell
                                  className="text-right font-bold"
                                  style={{ color: Number(row.remaining) >= 0 ? "var(--primary)" : "#dc2626" }}
                                >
                                  Rs. {(Number(row.remaining ?? row.running_balance) || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell className="text-right font-medium text-amber-700">
                                  Rs. {(Number(row.used) || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell className="text-right font-medium text-zinc-700">
                                  Rs. {(Number(row.limit) || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Bank Modal */}
      {showBankModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-5">
              {editingBankId ? "Edit Transaction Account" : "Add Transaction Account"}
            </h3>
            <form onSubmit={handleSubmitBank} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Account Title *</label>
                <Input value={bankForm.account_title} onChange={(e) => setBank("account_title", e.target.value)} required placeholder="e.g. Main Cash Account" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Date *</label>
                <Input type="date" value={bankForm.account_date} onChange={(e) => setBank("account_date", e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Description</label>
                <Input value={bankForm.description} onChange={(e) => setBank("description", e.target.value)} placeholder="e.g. Primary operating account" />
              </div>
              {!editingBankId && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Opening Balance (Rs.)</label>
                  <Input type="number" step="any" min="0" value={bankForm.current_balance} onChange={(e) => setBank("current_balance", e.target.value)} />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={bankForm.active} onChange={(e) => setBank("active", e.target.checked)} className="w-4 h-4 rounded" />
                Active
              </label>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPending ? "Saving…" : "Save Account"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowBankModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Vendor Modal */}
      {showVendorModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-5">
              {editingVendorId ? "Edit Vendor Account" : "Add Vendor Account"}
            </h3>
            <form onSubmit={handleSubmitVendor} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Account Title *</label>
                <Input
                  value={vendorForm.account_title}
                  onChange={(e) => setVendor("account_title", e.target.value)}
                  required
                  placeholder="e.g. CCBPL Credit Account"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Date *</label>
                <Input
                  type="date"
                  value={vendorForm.account_date}
                  onChange={(e) => setVendor("account_date", e.target.value)}
                  required
                />
              </div>
              {!editingVendorId && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Initial Used (Rs.)</label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 0 or 487457.84"
                    value={vendorForm.current_balance}
                    onChange={(e) => setVendor("current_balance", e.target.value)}
                  />
                  <p className="text-xs text-zinc-400 mt-1">
                    Initial amount of limit already used when opening this account.
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vendorForm.active}
                  onChange={(e) => setVendor("active", e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                Active
              </label>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPending ? "Saving…" : "Save Account"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowVendorModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
