import type { Branch, Org, User } from '../../types';

export const SEED_ORG: Org = {
  id: 'org_race',
  name: 'Race Auto Spares Pvt Ltd',
  pan: 'AAGCR4231F',
  gstRegistrationType: 'regular',
  aatoAbove5Cr: true, // e-invoicing mandate applies — demos the IRP flow
  fiscalYearLabel: 'FY 2026-27',
  fiscalYearStart: '2026-04-01',
  fiscalYearEnd: '2027-03-31',
  baseCurrency: 'INR',
  address: '42, Anna Salai, Guindy, Chennai 600032',
  email: 'accounts@raceautospares.in',
  phone: '+91 98400 12345',
};

export const FY_SHORT = '26-27';

export const SEED_BRANCHES: Branch[] = [
  {
    id: 'br_chennai',
    name: 'Chennai HO',
    gstin: '33AAGCR4231F1Z6',
    stateCode: '33',
    address: '42, Anna Salai, Guindy, Chennai 600032',
    isPrimary: true,
  },
  {
    id: 'br_bengaluru',
    name: 'Bengaluru Depot',
    gstin: '29AAGCR4231F1Z4',
    stateCode: '29',
    address: '18, Hosur Road, Bommanahalli, Bengaluru 560068',
    isPrimary: false,
  },
];

export const SEED_USERS: User[] = [
  { id: 'u_arun', name: 'Arun Kumar', email: 'arun@raceautospares.in', role: 'admin', avatarColor: '#6366f1' },
  { id: 'u_priya', name: 'Priya Raman', email: 'priya@raceautospares.in', role: 'accountant', avatarColor: '#0ea5e9' },
  { id: 'u_vikram', name: 'Vikram Shetty', email: 'vikram@raceautospares.in', role: 'sales', avatarColor: '#f59e0b' },
  { id: 'u_deepa', name: 'Deepa Nair', email: 'deepa@raceautospares.in', role: 'viewer', avatarColor: '#10b981' },
];
