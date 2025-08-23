import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner'; // ADDED
import { storage } from '@/utils/storage';
import { supabase } from '@/integrations/supabase/client';
import PokerTable from '@/pages/PokerTable';
import TableSelection from '@/pages/TableSelection';
import Onboarding from '@/pages/Onboarding';

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => {
        console.log('[PWA] Service worker registered:', reg);
      })
      .catch(err => {
        console.error('[PWA] Service worker registration failed:', err);
      });
  });
}

// Top-level DOM check for manifest link (runs before React mounts)
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      console.log('[PWA][DOMLoaded] Manifest link found in <head>:', manifestLink.getAttribute('href'));
    } else {
      console.warn('[PWA][DOMLoaded] Manifest link NOT found in <head>');
    }
    console.log('[PWA][DOMLoaded] <head> innerHTML:', document.head.innerHTML);
  });
}

const IndexPage = () => {
  const [profile, setProfile] = useState<any>(() => {
    const p = storage.getProfile();
    console.log('[Index.init] profile from storage:', p);
    return p;
  });
  const [table, setTable] = useState<any>(() => {
    const t = storage.getTable();
    console.log('[Index.init] table from storage:', t);
    return t;
  });
  const [hydrating, setHydrating] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [debugTick, setDebugTick] = useState(0);
  const [waitingForApproval, setWaitingForApproval] = useState(false); // ADDED
  const [pendingJoinTableId, setPendingJoinTableId] = useState<string | null>(null); // ADDED
  const selectingRef = useRef(false); // ADDED: reentrancy / double-click guard

  // ADDED: helper to normalize a raw table row (from creation/join) into canonical shape
  const normalizeSelectedTable = (raw: any, currentProfile: any) => {
    if (!raw) return null;
    const adminPlayerId = raw.adminId || raw.admin_player_id || raw.admin_user_id; // tolerate legacy
    const joinCode = raw.joinCode ?? raw.join_code;
    const profileId = currentProfile?.id;
    const isCreator = profileId && adminPlayerId && profileId === adminPlayerId;

    // Start with canonical shape
    const base = {
      id: raw.id,
      name: raw.name,
      status: raw.status,
      joinCode,
      adminId: adminPlayerId,
      adminName: raw.adminName || raw.admin_name || (isCreator ? currentProfile?.name : undefined),
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      // REMOVED: No longer managing players array here
    };

    // Ensure players array includes admin if we own it
    let players: any[] = Array.isArray(raw.players) ? [...raw.players] : [];
    if (isCreator) {
      const hasAdmin = players.some(p => p.id === profileId);
      if (!hasAdmin) {
        players.unshift({
          id: profileId,
            name: currentProfile?.name,
            totalPoints: 0,
            active: true,
            pending: false
        });
      }
    }

    return { ...base, players };
  };

  // NEW: log at start of each render
  console.log('[Index.render.start]', {
    tick: debugTick,
    hydrating,
    table,
    profile,
    path: window.location.pathname
  });

  // Logging (retained)
  useEffect(() => {
    console.log('[Index.state]', {
      tick: debugTick,
      hydrating,
      tableId: table?.id || null,
      profileId: profile?.id || null
    });
  }, [debugTick, hydrating, table, profile]);
  useEffect(() => { setDebugTick(t => t + 1); }, [hydrating, table, profile]);

  // REPLACED: simplified hydration (only URL validation / fetch if needed)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      console.log('[Index.hydrate] start (validate URL vs stored table)');
      try {
        const path = window.location.pathname;
        const m = path.match(/^\/table\/([0-9a-fA-F-]{32,})$/);
        const urlTableId = m ? m[1] : null;

        if (urlTableId && urlTableId !== table?.id) {
          const { data, error } = await supabase
            .from('poker_tables')
            .select('*')
            .eq('id', urlTableId)
            .maybeSingle();
          if (!cancelled && data && !error) {
            const hydratedTable = {
              id: data.id,
              name: data.name,
              status: data.status,
              joinCode: data.join_code,
              adminId: data.admin_player_id,
              players: [] // defer players; PokerTable will refresh
            };
            setTable(hydratedTable);
            storage.setTable(hydratedTable);
          } else if (!cancelled && error) {
            // invalid URL -> clear
            setTable(null);
            storage.clearTable();
          }
        }
      } finally {
        if (!cancelled) {
          setRefreshKey(k => k + 1);
          setHydrating(false);
          console.log('[Index.hydrate] complete');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NEW: if storage had a table but URL not canonical (e.g. user refreshed at /), fix after hydration
  useEffect(() => {
    if (hydrating) return;
    if (table?.id && window.location.pathname !== `/table/${table.id}`) {
      console.log('[Index.canonicalize] applying canonical URL for stored table');
      window.history.replaceState(null, '', `/table/${table.id}`);
    }
  }, [hydrating, table?.id]);

  // NEW: fallback re-check a short moment after hydration to recover missed table (paranoid guard)
  useEffect(() => {
    if (hydrating) return;
    if (table) return;
    const stored = storage.getTable();
    if (!stored) return;
    console.log('[Index.fallback] table state null but storage has table -> restoring');
    setTable(stored);
    setRefreshKey(k => k + 1);
  }, [hydrating, table]);

  // Canonical URL management (unchanged logic, adjusted for synchronous init)
  useEffect(() => {
    if (hydrating) return;
    if (table?.id) {
      const desired = `/table/${table.id}`;
      if (window.location.pathname !== desired) {
        window.history.replaceState(null, '', desired);
      }
    } else if (window.location.pathname.startsWith('/table/')) {
      window.history.replaceState(null, '', '/');
    }
  }, [hydrating, table?.id]);

  // Persist (post-hydration)
  useEffect(() => {
    if (hydrating) return;
    try {
      if (profile) storage.setProfile(profile);
      if (table) storage.setTable(table);
      else storage.clearTable();
    } catch (e) {
      console.warn('[Index.persist] failed', e);
    }
  }, [hydrating, profile, table]);

  // Before unload safeguard (unchanged)
  useEffect(() => {
    const handler = () => {
      if (sessionStorage.getItem('is_resetting') === 'true') {
        console.log('[Index.beforeunload] skipping persist due to reset flag');
        return;
      }
      try {
        if (profile) storage.setProfile(profile);
        if (table) storage.setTable(table); else storage.clearTable();
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [profile, table]);

  // ADDED: detect reset flag on mount (ensures clean state even if something lingers)
  useEffect(() => {
    if (sessionStorage.getItem('is_resetting') === 'true') {
      console.log('[Index.reset] detected reset flag – clearing in-memory state');
      sessionStorage.removeItem('is_resetting');
      setProfile(null);
      setTable(null);
      storage.clearTable();
    }
  }, []);

  // ADDED: onboarding profile creation handler
  const handleProfileCreated = async (newProfile: any) => {
    try {
      if (!newProfile?.id || !newProfile?.name) {
        console.error('[Index.onboarding] invalid profile payload', newProfile);
        return;
      }
      console.log('[Index.onboarding] creating profile', newProfile);
      setProfile(newProfile);
      storage.setProfile(newProfile);
      // best‑effort insert (ignore duplicate)
      await supabase.from('players').upsert({ id: newProfile.id, name: newProfile.name, avatar: newProfile.avatar || null }, { onConflict: 'id', ignoreDuplicates: false });
    } catch (e) {
      console.warn('[Index.onboarding] profile insert/upsert failed (ignored)', e);
    }
  };

  // ADDED: if no profile but URL points to a table, normalize to root before onboarding
  useEffect(() => {
    if (!hydrating && !profile && window.location.pathname.startsWith('/table/')) {
      window.history.replaceState(null, '', '/');
    }
  }, [hydrating, profile]);

  // ADDED: Listen for join approvals
  useEffect(() => {
    if (!profile?.id || !pendingJoinTableId) return;

    const channel = supabase
      .channel(`user_${profile.id}`)
      .on('broadcast', { event: 'join_approved' }, (payload) => {
        if (payload.payload?.tableId === pendingJoinTableId) {
          toast.success("You've been approved to join the table!");
          // Fetch the full table data and navigate
          (async () => {
            const { data, error } = await supabase
              .from('poker_tables')
              .select('*')
              .eq('id', pendingJoinTableId)
              .single();
            
            if (data && !error) {
              const normalized = normalizeSelectedTable(data, profile);
              setTable(normalized);
              storage.setTable(normalized);
              setWaitingForApproval(false);
              setPendingJoinTableId(null);
            }
          })();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, pendingJoinTableId]);

  // --- RESET & FORCE ONBOARDING HANDLING (moved up) ---
  useEffect(() => {
    // Single consolidated reset handler (removes duplicate later hook)
    if (storage.isResetting?.()) {
      console.log('[Index.reset] detected reset flag – clearing in-memory state');
      storage.clearResetFlag?.();
      setProfile(null);
      setTable(null);
      storage.clearTable();
    }
    // Force onboarding flag (optional)
    if (storage.shouldForceOnboarding?.()) {
      console.log('[Index.forceOnboarding] flag set – clearing table and awaiting onboarding');
      setTable(null);
      storage.clearTable();
    }
  }, []);

  // Manifest and service worker logging (move this above the onboarding guard)
  useEffect(() => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      console.log('[PWA] Manifest link found in <head>:', manifestLink.getAttribute('href'));
    } else {
      console.warn('[PWA] Manifest link NOT found in <head>');
    }

    fetch('/manifest.json')
      .then(res => {
        console.log('[PWA] Manifest fetch status:', res.status);
        if (res.ok) {
          console.log('[PWA] Manifest fetched successfully');
          return res.json();
        } else {
          console.error('[PWA] Manifest fetch failed with status:', res.status);
        }
      })
      .then(json => {
        if (json) {
          console.log('[PWA] Manifest content:', json);
        }
      })
      .catch(err => {
        console.error('[PWA] Manifest fetch error:', err);
      });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          console.log('[PWA] Service worker registration found:', reg);
        } else {
          console.warn('[PWA] No service worker registration found');
        }
      });
    }

    console.log('[PWA] <head> innerHTML:', document.head.innerHTML);
  }, []);

  // Onboarding guard (unchanged)
  if (!profile || storage.shouldForceOnboarding?.()) {
    if (storage.shouldForceOnboarding?.()) {
      storage.clearForceOnboardingFlag?.();
    }
    console.log('[Index.render] no profile -> onboarding');
    return <Onboarding onSetProfile={handleProfileCreated} />;
  }

  // If we are still hydrating but have no table from storage, show a loading screen.
  // This prevents a "flash" of the TableSelection page before hydration completes.
  if (hydrating && !table) {
    console.log('[Index.render] loading (hydrating, no initial table)');
    return (
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
        fontSize: 14,
        opacity: 0.85
      }}>
        Loading...
      </div>
    );
  }

  // keep decide log AFTER onboarding guard
  console.log('[Index.render] decide', { tableId: table?.id || null });

  // Add state for PWA install prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Listen for beforeinstallprompt event
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return (
    <>
      {table ? (
        <PokerTable
          table={table}
          profile={profile}
          refreshKey={refreshKey}
          onExit={() => {
            console.log('[Index.onExit] Clearing table state.');
            setTable(null);
            storage.clearTable();
            // No navigation needed, re-render will show TableSelection
          }}
        />
      ) : (
        <TableSelection
          table={null}
          profile={profile}
          onCreateTable={(raw: any) => {
            if (!raw) return;
            if (selectingRef.current) return;
            selectingRef.current = true;
            
            const normalized = normalizeSelectedTable(raw, profile);
            if (!normalized) {
              selectingRef.current = false;
              return;
            }

            setTable(normalized);
            storage.setTable(normalized);
            setRefreshKey(k => k + 1);
            
            if (normalized.id) {
              window.history.replaceState(null, '', `/table/${normalized.id}`);
            }

            setTimeout(() => { selectingRef.current = false; }, 300);
          }}
          onJoinTable={(raw: any) => {
            // This handler is now only responsible for setting the "waiting" state.
            // The actual join request is created in TableSelection.tsx
            if (!raw?.id) return;
            setPendingJoinTableId(raw.id);
            setWaitingForApproval(true);
            toast('Request sent!', { description: 'Waiting for the admin to approve your request.' });
          }}
          waitingApproval={waitingForApproval ?? false}
        />
      )}
      {/* Add Install App button if install prompt is available */}
      {deferredPrompt && (
        <button
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 9999,
            padding: '10px 18px',
            background: '#10b981',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
          onClick={() => {
            deferredPrompt.prompt();
            setDeferredPrompt(null);
          }}
        >
          Install App
        </button>
      )}
    </>
  );
};

export default IndexPage;