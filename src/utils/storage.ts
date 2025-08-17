import { Profile, Table } from '@/types';

// Add logging and checks to storage utility to prevent stale/null data

const PROFILE_KEY = 'profile';
const TABLE_KEY = 'table';

export const storage = {
  setProfile(profile: any) {
    console.log('[storage] setProfile:', profile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  getProfile() {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      console.warn('[storage] getProfile: no profile found in storage');
      return null;
    }
    try {
      const profile = JSON.parse(raw);
      if (!profile || !profile.id) {
        console.warn('[storage] getProfile: invalid profile data', profile);
        return null;
      }
      return profile;
    } catch (e) {
      console.error('[storage] getProfile: error parsing profile', e);
      return null;
    }
  },
  setTable(table: any) {
    console.log('[storage] setTable:', table);
    localStorage.setItem(TABLE_KEY, JSON.stringify(table));
  },
  getTable() {
    const raw = localStorage.getItem(TABLE_KEY);
    if (!raw) {
      console.warn('[storage] getTable: no table found in storage');
      return null;
    }
    try {
      const table = JSON.parse(raw);
      if (!table || !table.id) {
        console.warn('[storage] getTable: invalid table data', table);
        return null;
      }
      return table;
    } catch (e) {
      console.error('[storage] getTable: error parsing table', e);
      return null;
    }
  },
  clear() {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(TABLE_KEY);
    console.log('[storage] cleared profile and table');
  }
};

export function uid(prefix = ''): string {
  return (
    prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export function fourDigitCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
