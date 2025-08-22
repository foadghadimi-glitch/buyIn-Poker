import { Profile, Table } from '@/types';
import { Player, PokerTable } from '@/integrations/supabase/types';

// Add logging and checks to storage utility to prevent stale/null data

const PROFILE_KEY = 'poker_profile';
const TABLE_KEY = 'poker_table';
const RESET_FLAG_KEY = 'is_resetting';
const FORCE_ONBOARD_KEY = 'force_onboarding';

export const storage = {
  setProfile(profile: Player) {
    console.log('[storage] setProfile:', profile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  getProfile(): Player | null {
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
  setTable(table: PokerTable | null) {
    console.log('[storage] setTable:', table);
    if (table) {
      localStorage.setItem(TABLE_KEY, JSON.stringify(table));
    } else {
      localStorage.removeItem(TABLE_KEY);
    }
  },
  getTable(): PokerTable | null {
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
  clearTable() {
    localStorage.removeItem(TABLE_KEY);
  },
  clear() {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(TABLE_KEY);
    console.log('[storage] cleared profile and table');
  },
  // MODIFIED: clearAll now sets a flag before clearing data.
  clearAll() {
    sessionStorage.setItem(RESET_FLAG_KEY, 'true');
    sessionStorage.setItem(FORCE_ONBOARD_KEY, 'true'); // ADDED
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(TABLE_KEY);
    console.log('[storage] Reset flag set and all application data cleared.');
  },
  // ADDED: Function to check the reset flag
  isResetting() {
    return sessionStorage.getItem(RESET_FLAG_KEY) === 'true';
  },
  // ADDED: Function to clear the reset flag after use
  clearResetFlag() {
    sessionStorage.removeItem(RESET_FLAG_KEY);
  },
  // ADDED: check & clear force onboarding flag
  shouldForceOnboarding() {
    return sessionStorage.getItem(FORCE_ONBOARD_KEY) === 'true';
  },
  clearForceOnboardingFlag() {
    sessionStorage.removeItem(FORCE_ONBOARD_KEY);
  },
};

export function uid(prefix = ''): string {
  return (
    prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export function fourDigitCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
