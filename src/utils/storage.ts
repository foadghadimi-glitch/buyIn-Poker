import { Profile, Table } from '@/types';

const PROFILE_KEY = 'poker_profile_v1';
const TABLE_KEY = 'poker_table_v1';

export const storage = {
  getProfile(): Profile | null {
    const v = localStorage.getItem(PROFILE_KEY);
    return v ? (JSON.parse(v) as Profile) : null;
  },
  setProfile(profile: Profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  clearProfile() {
    localStorage.removeItem(PROFILE_KEY);
  },
  getTable(): Table | null {
    const v = localStorage.getItem(TABLE_KEY);
    return v ? (JSON.parse(v) as Table) : null;
  },
  setTable(table: Table) {
    localStorage.setItem(TABLE_KEY, JSON.stringify(table));
  },
  clearTable() {
    localStorage.removeItem(TABLE_KEY);
  },
};

export function uid(prefix = ''): string {
  return (
    prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export function sixDigitCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
