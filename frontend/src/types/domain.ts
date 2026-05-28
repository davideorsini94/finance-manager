export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  locale: string;
  isActive: boolean;
  /** Conto preferito (precompilato nei form di nuovo movimento). */
  favoriteAccountId: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string | null;
}

export type AccountType = 'checking' | 'credit_card' | 'cash';
export type AccountMemberRole = 'owner' | 'write' | 'read';

export interface AccountMember {
  accountId: string;
  userId: string;
  role: AccountMemberRole;
  user: UserSummary;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balanceCents: string;
  ownerId: string;
  paymentAccountId: string | null;
  billingDay: number | null;
  color: string | null;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  owner: UserSummary;
  members: AccountMember[];
}

export interface Category {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  isIncome: boolean;
  sortOrder: number;
  createdAt: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface AttachmentSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  userId: string;
  amountCents: string;
  type: TransactionType;
  categoryId: string | null;
  description: string | null;
  notes: string | null;
  transactionDate: string;
  transferPairId: string | null;
  ccChargeId: string | null;
  recurringRuleId: string | null;
  importBatchId: string | null;
  isPending: boolean;
  category: Pick<Category, 'id' | 'name' | 'color' | 'icon' | 'isIncome'> | null;
  account: { id: string; name: string; type: AccountType };
  attachments: AttachmentSummary[];
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
