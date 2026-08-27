// ─────────────────────────────────────────────────────────────────────────────
// Single Zustand store, persisted to localStorage. Holds ALL app data (this is
// the demo's "database"). Business logic lives in lib/services/* — components
// never mutate collections directly, they call services. Services are written
// so their signatures match the future real API; swapping the mock for HTTP
// later means changing service internals only.
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Account, ApiToken, ApprovalRule, AuditEvent, BankAccount, BankRule, BankTxn,
  Bill, Branch, Cheque, Contact, CreditNote, CustomFieldDef, DeliveryChallan,
  Estimate, EwayBill, Expense, Gstr2bEntry, Invoice, Item, JournalEntry,
  NumberSeriesState, Org, Payment, PurchaseOrder, RetainerInvoice, RoleName,
  SalesOrder, StockMove, User, VendorCredit, Warehouse, WorkflowRule,
} from '../types';

export interface Session {
  userId: string;
  role: RoleName;
}

export interface AppState {
  seeded: boolean;
  session: Session | null;

  org: Org | null;
  branches: Branch[];
  users: User[];
  activeBranchId: string;

  accounts: Account[];
  contacts: Contact[];
  items: Item[];

  invoices: Invoice[];
  estimates: Estimate[];
  salesOrders: SalesOrder[];
  challans: DeliveryChallan[];
  creditNotes: CreditNote[];
  retainers: RetainerInvoice[];

  bills: Bill[];
  expenses: Expense[];
  purchaseOrders: PurchaseOrder[];
  vendorCredits: VendorCredit[];

  payments: Payment[];

  bankAccounts: BankAccount[];
  bankTxns: BankTxn[];
  bankRules: BankRule[];
  cheques: Cheque[];

  entries: JournalEntry[];
  nextEntryNo: number;
  series: NumberSeriesState;
  audit: AuditEvent[];

  gstr2b: Gstr2bEntry[];
  ewayBills: EwayBill[];

  warehouses: Warehouse[];
  stockMoves: StockMove[];

  workflows: WorkflowRule[];
  approvals: ApprovalRule[];
  customFields: CustomFieldDef[];
  apiTokens: ApiToken[];
  webhooks: { id: string; url: string; events: string[]; isActive: boolean }[];

  // ── session actions (the only logic that lives in the store itself)
  login: (userId: string, role: RoleName) => void;
  logout: () => void;
  setActiveBranch: (branchId: string) => void;
}

export const EMPTY_COLLECTIONS = {
  seeded: false,
  session: null,
  org: null,
  branches: [] as Branch[],
  users: [] as User[],
  activeBranchId: '',
  accounts: [] as Account[],
  contacts: [] as Contact[],
  items: [] as Item[],
  invoices: [] as Invoice[],
  estimates: [] as Estimate[],
  salesOrders: [] as SalesOrder[],
  challans: [] as DeliveryChallan[],
  creditNotes: [] as CreditNote[],
  retainers: [] as RetainerInvoice[],
  bills: [] as Bill[],
  expenses: [] as Expense[],
  purchaseOrders: [] as PurchaseOrder[],
  vendorCredits: [] as VendorCredit[],
  payments: [] as Payment[],
  bankAccounts: [] as BankAccount[],
  bankTxns: [] as BankTxn[],
  bankRules: [] as BankRule[],
  cheques: [] as Cheque[],
  entries: [] as JournalEntry[],
  nextEntryNo: 1,
  series: {} as NumberSeriesState,
  audit: [] as AuditEvent[],
  gstr2b: [] as Gstr2bEntry[],
  ewayBills: [] as EwayBill[],
  warehouses: [] as Warehouse[],
  stockMoves: [] as StockMove[],
  workflows: [] as WorkflowRule[],
  approvals: [] as ApprovalRule[],
  customFields: [] as CustomFieldDef[],
  apiTokens: [] as ApiToken[],
  webhooks: [] as { id: string; url: string; events: string[]; isActive: boolean }[],
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...EMPTY_COLLECTIONS,
      login: (userId, role) =>
        set((s) => {
          // A user works within their branch, so signing in adopts it.
          const home = s.users.find((u) => u.id === userId)?.branchId;
          return {
            session: { userId, role },
            activeBranchId: home ?? s.activeBranchId,
          };
        }),
      logout: () => set({ session: null }),
      setActiveBranch: (branchId) => set({ activeBranchId: branchId }),
    }),
    {
      name: 'finance-app-demo-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Convenience typed getters used by services. */
export const getState = () => useAppStore.getState();
export const setState = useAppStore.setState;
