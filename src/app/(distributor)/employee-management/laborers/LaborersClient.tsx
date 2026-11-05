"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import {
  Plus, Edit2, Trash2, ChevronDown, ChevronRight, User, Phone,
  Calendar, Briefcase, Clock, Loader2, X, Filter
} from "lucide-react";
import {
  LaborerRecord,
  LaborerPerson,
  createLaborer,
  updateLaborer,
  deleteLaborer,
  getLaborers,
} from "@/lib/actions/laborers";

interface Props {
  initialLaborers: LaborerRecord[];
}

interface PersonFormItem {
  id?: string;
  name: string;
  phone: string;
}

const TODAY = new Date().toISOString().split("T")[0];
const FIRST_DAY_OF_MONTH = `${TODAY.substring(0, 8)}01`;

function calculateDays(from: string, to: string): number {
  if (!from || !to) return 1;
  const d1 = new Date(from);
  const d2 = new Date(to);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays > 0 ? diffDays : 1;
}

export function LaborersClient({ initialLaborers }: Props) {
  const router = useRouter();
  const [laborers, setLaborers] = useState<LaborerRecord[]>(initialLaborers || []);
  const [fromDate, setFromDate] = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate] = useState(TODAY);
  const [isLoadingFilter, setIsLoadingFilter] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Expanded rows state
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [work, setWork] = useState("");
  const [formFromDate, setFormFromDate] = useState(TODAY);
  const [formToDate, setFormToDate] = useState(TODAY);
  const [days, setDays] = useState(1);
  const [persons, setPersons] = useState<PersonFormItem[]>([{ name: "", phone: "" }]);
  const [formError, setFormError] = useState("");

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleFromDateChange = (val: string) => {
    setFormFromDate(val);
    setDays(calculateDays(val, formToDate));
  };

  const handleToDateChange = (val: string) => {
    setFormToDate(val);
    setDays(calculateDays(formFromDate, val));
  };

  const openAddModal = () => {
    setEditingId(null);
    setWork("");
    setFormFromDate(TODAY);
    setFormToDate(TODAY);
    setDays(1);
    setPersons([{ name: "", phone: "" }]);
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (laborer: LaborerRecord) => {
    setEditingId(laborer.id);
    setWork(laborer.work);
    setFormFromDate(laborer.from_date);
    setFormToDate(laborer.to_date);
    setDays(laborer.days || calculateDays(laborer.from_date, laborer.to_date));
    setPersons(
      laborer.persons && laborer.persons.length > 0
        ? laborer.persons.map((p) => ({ id: p.id, name: p.name, phone: p.phone || "" }))
        : [{ name: "", phone: "" }]
    );
    setFormError("");
    setShowModal(true);
  };

  const handleAddPerson = () => {
    setPersons((prev) => [...prev, { name: "", phone: "" }]);
  };

  const handleRemovePerson = (index: number) => {
    if (persons.length === 1) return;
    setPersons((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePersonChange = (index: number, field: "name" | "phone", value: string) => {
    setPersons((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const handleLoad = async () => {
    setIsLoadingFilter(true);
    try {
      const filtered = await getLaborers({ fromDate, toDate });
      setLaborers(filtered);
      setHasLoaded(true);
    } catch (err: any) {
      alert("Failed to load laborers: " + (err?.message || err));
    } finally {
      setIsLoadingFilter(false);
    }
  };

  const handleSave = () => {
    if (!work.trim()) {
      setFormError("Please enter the work description.");
      return;
    }
    if (!formFromDate || !formToDate) {
      setFormError("Please select both From and To dates.");
      return;
    }
    const hasAtLeastOnePerson = persons.some((p) => p.name.trim());
    if (!hasAtLeastOnePerson) {
      setFormError("Please provide at least one person's name (P1).");
      return;
    }

    setFormError("");
    startTransition(async () => {
      try {
        if (editingId) {
          await updateLaborer(editingId, {
            work: work.trim(),
            from_date: formFromDate,
            to_date: formToDate,
            days: days > 0 ? days : 1,
            persons: persons.filter((p) => p.name.trim()),
          });
        } else {
          await createLaborer({
            work: work.trim(),
            from_date: formFromDate,
            to_date: formToDate,
            days: days > 0 ? days : 1,
            persons: persons.filter((p) => p.name.trim()),
          });
        }
        setShowModal(false);
        const refreshed = await getLaborers(
          fromDate && toDate ? { fromDate, toDate } : undefined
        );
        setLaborers(refreshed);
        setHasLoaded(true);
        router.refresh();
      } catch (err: any) {
        setFormError(err?.message || "Failed to save laborer record.");
      }
    });
  };

  const handleDelete = (id: string, workName: string) => {
    if (!confirm(`Are you sure you want to delete "${workName}" and its person records?`)) return;
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteLaborer(id);
        setLaborers((prev) => prev.filter((l) => l.id !== id));
        router.refresh();
      } catch (err: any) {
        alert("Failed to delete: " + (err?.message || err));
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Top Filter & Action Bar */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600">
            <Filter className="h-3.5 w-3.5 text-zinc-400" />
            <span>Filter Period:</span>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-zinc-500">From</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 text-sm w-36"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-zinc-500">To</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 text-sm w-36"
            />
          </div>
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={isLoadingFilter}
            className="flex items-center gap-1 h-8 px-3"
          >
            {isLoadingFilter ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            <span>Load</span>
          </Button>
        </div>

        <Button
          onClick={openAddModal}
          className="flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Add Laborer</span>
        </Button>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50/80">
              <TableHead className="w-10"></TableHead>
              <TableHead>Work</TableHead>
              <TableHead>From - To</TableHead>
              <TableHead className="text-center">Days</TableHead>
              <TableHead className="text-center">Persons</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!hasLoaded ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-zinc-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Filter className="h-8 w-8 text-zinc-300 stroke-1" />
                    <p className="text-sm font-medium">No entries loaded</p>
                    <p className="text-xs text-zinc-400">
                      Select From - To dates and click &quot;Load&quot; to view laborer records.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : laborers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-zinc-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Briefcase className="h-8 w-8 text-zinc-300 stroke-1" />
                    <p className="text-sm font-medium">No laborer records found</p>
                    <p className="text-xs text-zinc-400">
                      Click &quot;Add Laborer&quot; above to create a new work record.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              laborers.map((laborer) => {
                const isExpanded = !!expandedRows[laborer.id];
                const isDeleting = deletingId === laborer.id;

                return (
                  <TableRowGroup key={laborer.id}>
                    <TableRow
                      className={`cursor-pointer transition-colors hover:bg-zinc-50/80 ${
                        isExpanded ? "bg-zinc-50/50" : ""
                      }`}
                      onClick={() => toggleRow(laborer.id)}
                    >
                      <TableCell className="w-10 pr-0">
                        <button
                          type="button"
                          className="p-1 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(laborer.id);
                          }}
                          aria-label="Toggle persons list"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-700" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>

                      <TableCell className="font-semibold text-zinc-900">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{laborer.work}</span>
                        </div>
                      </TableCell>

                      <TableCell className="text-sm font-medium text-zinc-600">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                          <span>{laborer.from_date}</span>
                          <span className="text-zinc-400">→</span>
                          <span>{laborer.to_date}</span>
                        </div>
                      </TableCell>

                      <TableCell className="text-center font-mono font-semibold text-sm text-zinc-800">
                        {laborer.days}
                      </TableCell>

                      <TableCell className="text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          <User className="h-3 w-3" />
                          {laborer.persons_count} {laborer.persons_count === 1 ? "person" : "persons"}
                        </span>
                      </TableCell>

                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(laborer)}
                            className="h-8 px-2.5 text-xs flex items-center gap-1"
                          >
                            <Edit2 className="h-3.5 w-3.5 text-zinc-600" />
                            <span>Edit</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(laborer.id, laborer.work)}
                            disabled={isDeleting}
                            className="h-8 px-2.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 flex items-center gap-1"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            <span>Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Drop Down Persons Sub-row */}
                    {isExpanded && (
                      <TableRow className="bg-zinc-50/40 hover:bg-zinc-50/60 border-b border-zinc-200">
                        <TableCell colSpan={6} className="py-3 px-8">
                          <div className="bg-white rounded-lg border border-zinc-200 p-4 shadow-xs space-y-3">
                            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-blue-600" />
                                Assigned Persons ({laborer.persons.length})
                              </span>
                              <span className="text-xs text-zinc-400">
                                Work: {laborer.work}
                              </span>
                            </div>

                            {laborer.persons.length === 0 ? (
                              <p className="text-xs text-zinc-400 italic py-1">
                                No person records added for this work.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                {laborer.persons.map((p, pIdx) => (
                                  <div
                                    key={p.id || pIdx}
                                    className="flex items-center justify-between p-2.5 bg-zinc-50 rounded-md border border-zinc-200/80 text-xs"
                                  >
                                    <div className="flex items-center gap-2 overflow-hidden">
                                      <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[0.625rem]">
                                        P{pIdx + 1}
                                      </div>
                                      <span className="font-semibold text-zinc-800 truncate">
                                        {p.name}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-zinc-500 font-mono shrink-0 ml-2">
                                      {p.phone ? (
                                        <>
                                          <Phone className="h-3 w-3 text-zinc-400" />
                                          <a
                                            href={`tel:${p.phone}`}
                                            className="hover:underline text-zinc-700"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {p.phone}
                                          </a>
                                        </>
                                      ) : (
                                        <span className="text-zinc-400 italic">No phone</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableRowGroup>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit Laborer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="bg-white rounded-xl shadow-2xl border border-zinc-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/70">
              <h2 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-blue-600" />
                {editingId ? "Edit Laborer" : "Add Laborer"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-zinc-400 hover:text-zinc-600 rounded-lg p-1 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {formError && (
                <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg font-medium">
                  {formError}
                </div>
              )}

              {/* Work Input */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700">
                  Work <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Loading Stock, Wall Painting, Plastering..."
                  value={work}
                  onChange={(e) => setWork(e.target.value)}
                  className="w-full text-sm"
                  autoFocus
                />
              </div>

              {/* Dates & Days */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">
                    From <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="date"
                    value={formFromDate}
                    onChange={(e) => handleFromDateChange(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">
                    To <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="date"
                    value={formToDate}
                    onChange={(e) => handleToDateChange(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">
                    Days (auto filled)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    value={days}
                    onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
                    className="text-sm font-mono font-semibold bg-zinc-50"
                  />
                </div>
              </div>

              {/* Persons Section */}
              <div className="space-y-3 pt-2 border-t border-zinc-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-800 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-blue-600" />
                    Persons List
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddPerson}
                    className="h-7 px-2 text-xs font-semibold flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Persons</span>
                  </Button>
                </div>

                <div className="space-y-2.5">
                  {persons.map((p, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-zinc-50 rounded-lg border border-zinc-200/90 flex flex-col sm:flex-row gap-2.5 items-start sm:items-center"
                    >
                      <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                        P{idx + 1}
                      </div>
                      <div className="flex-1 w-full sm:w-auto">
                        <Input
                          type="text"
                          placeholder={`P${idx + 1} Name`}
                          value={p.name}
                          onChange={(e) => handlePersonChange(idx, "name", e.target.value)}
                          className="h-8 text-xs w-full bg-white"
                        />
                      </div>
                      <div className="flex-1 w-full sm:w-auto">
                        <Input
                          type="text"
                          placeholder={`P${idx + 1} Phone`}
                          value={p.phone}
                          onChange={(e) => handlePersonChange(idx, "phone", e.target.value)}
                          className="h-8 text-xs w-full bg-white font-mono"
                        />
                      </div>
                      {persons.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePerson(idx)}
                          className="p-1 text-zinc-400 hover:text-red-600 rounded transition-colors self-end sm:self-center"
                          title="Remove person"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-zinc-200 bg-zinc-50/70 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowModal(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="flex items-center gap-1.5"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Save</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
