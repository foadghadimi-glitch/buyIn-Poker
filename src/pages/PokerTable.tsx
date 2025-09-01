import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { storage } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { v4 as uuidv4 } from 'uuid';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog as HistoryDialog, DialogContent as HistoryDialogContent, DialogHeader as HistoryDialogHeader, DialogTitle as HistoryDialogTitle, DialogFooter as HistoryDialogFooter, DialogTrigger as HistoryDialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Player, PokerTable as PokerTableType, TablePlayer } from '@/integrations/supabase/types';

// Update types to match new schema
type TablePlayer = {
  id: string; // now references players.id
  name: string;
  totalPoints?: number;
  active?: boolean;
  pending?: boolean; // waiting for admin approval
};

type PokerTableRow = {
  admin_player_id?: string; // changed from admin_user_id
  created_at?: string;
  id?: string;
  join_code?: string;
  name?: string;
  status?: "active" | "ended";
  updated_at?: string;
  players: TablePlayer[];
};

interface PokerTableProps {
  table: PokerTableType & {
    players: TablePlayer[];
    adminName?: string;
    joinCode?: number;
    adminId?: string;
  };
  profile?: Player | null; // ADDED
  refreshKey?: number; // ADD
  onExit: () => void; // ADDED
}

const PokerTable = ({ table, profile, refreshKey, onExit }: PokerTableProps) => {
  // NORMALIZE admin id & join code (covers snake_case / camelCase)
  const normalizedAdminId = table.adminId || table.admin_player_id;
  const normalizedJoinCode = table.joinCode ?? (table as any).join_code;
  const isAdmin = !!profile && !!normalizedAdminId && profile.id === normalizedAdminId;

  // Add new state to hold players loaded from table_players + players table
  const [players, setPlayers] = useState<TablePlayer[]>(table?.players || []);

  // NEW: Determine if the current user is a player on the table
  const isPlayerOnTable = useMemo(() => {
    if (!profile?.id || !players) return false;
    return players.some(p => p.id === profile.id);
  }, [players, profile?.id]);

  useEffect(() => {
    const reasons: string[] = [];
    if (!profile) reasons.push('no profile');
    if (!normalizedAdminId) reasons.push('no normalizedAdminId');
    if (profile && normalizedAdminId && profile.id !== normalizedAdminId) {
      reasons.push(`mismatch profile.id(${profile.id}) != normalizedAdminId(${normalizedAdminId})`);
    }
    console.log('[PokerTable.AdminEval]', {
      tableId: table?.id,
      profileId: profile?.id,
      normalizedAdminId,
      isAdmin,
      reasonsIfNotAdmin: isAdmin ? [] : reasons,
      tableKeys: Object.keys(table || {})
    });
  }, [table?.id, profile?.id, normalizedAdminId, isAdmin]);

  // NEW: verify incoming props and normalization
  useEffect(() => {
    console.log('[PokerTable.mount] props:', {
      table,
      profile,
      normalizedAdminId,
      normalizedJoinCode,
      isAdmin
    });
  }, []);

  // REPLACED noisy per-render debug log with effect (fires only on relevant changes)
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.log('[PokerTable][AdminCheck]', {
        profileId: profile?.id,
        normalizedAdminId,
        adminName: table.adminName,
        isAdmin,
        rawKeys: Object.keys(table || {})
      });
    }
  }, [profile?.id, normalizedAdminId, table.adminName, isAdmin]);

  // dev-only: log when propTable identity changes (avoid logging every render)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[PokerTable] propTable changed:', table?.id ? { id: table.id, name: table.name } : table);
    }
  }, [table?.id]);
  const navigate = useNavigate();
  const profileStorage = storage.getProfile();

  const [openBuyIn, setOpenBuyIn] = useState(false);
  const [openHistory, setOpenHistory] = useState(false); // Add state for history dialog
  const [openEndUp, setOpenEndUp] = useState(false); // Add state for end up dialog
  const [openExit, setOpenExit] = useState(false);
  const [amount, setAmount] = useState('');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [playerTotals, setPlayerTotals] = useState<Record<string, number>>({});
  // DIAG: keep previous totals snapshot for diff logging
  const prevTotalsRef = useRef<Record<string, number>>({});
  const [pendingJoinRequests, setPendingJoinRequests] = useState<any[]>([]);
  const [historyData, setHistoryData] = useState<any[]>([]); // Store buy-in history
  const [endUpValues, setEndUpValues] = useState<Record<string, number>>({}); // Store end up values per player
  const [processingRequests, setProcessingRequests] = useState<string[]>([]);
  const [processingJoinRequests, setProcessingJoinRequests] = useState<string[]>([]);
  const [processingExit, setProcessingExit] = useState(false);
  // prevent double-submit from UI for buy-in and join actions
  const [processingBuyIn, setProcessingBuyIn] = useState(false);
  const [processingJoinRequestLocal, setProcessingJoinRequestLocal] = useState(false);
  // synchronous refs to prevent double-submit race before state updates
  const processingBuyInRef = useRef(false);
  const processingJoinRef = useRef(false);
  const [adminName, setAdminName] = useState<string>('');

  const handleEndUpChange = (playerId: string, value: number) => {
    setEndUpValues(prev => ({ ...prev, [playerId]: value }));
  };

  // NEW: fetch admin name (used by refreshTableData + fallback effect)
  const fetchAdminName = async (tableId: string) => {
    try {
      const { data } = await supabase.from('poker_tables').select('admin_player_id').eq('id', tableId).maybeSingle();
      const adminId = data?.admin_player_id;
      if (!adminId) return setAdminName('N/A');
      const { data: player } = await supabase.from('players').select('name').eq('id', adminId).maybeSingle();
      setAdminName(player?.name || 'N/A');
    } catch (e) {
      console.warn('[PokerTable][fetchAdminName] error', e);
    }
  };

// ADD: fetchPendingJoinRequests (moved here so it's defined before first use anywhere)
  const fetchPendingJoinRequests = async (tableId: string) => {
    if (!tableId) return;
    try {
      const { data, error } = await supabase
        .from('join_requests')
        .select('id, player_id, created_at')
        .eq('table_id', tableId)
        .eq('status', 'pending');
      if (error) throw error;

      const rows = data || [];
      const playerIds = Array.from(new Set(rows.map(r => r.player_id))).filter(Boolean);
      let nameById: Record<string, string> = {};
      if (playerIds.length) {
        const { data: playersData } = await supabase
          .from('players')
          .select('id,name')
          .in('id', playerIds);
        (playersData || []).forEach(p => { nameById[p.id] = p.name; });
      }
      const mapped = rows.map(r => ({ ...r, player_name: nameById[r.player_id] || 'Unknown' }));
      console.log('[PokerTable][fetchPendingJoinRequests] mapped', mapped);
      setPendingJoinRequests(mapped);
      setPendingJoinPlayerIds(new Set(mapped.map(r => r.player_id)));
    } catch (e) {
      console.warn('[PokerTable][fetchPendingJoinRequests] fail', e);
      setPendingJoinRequests([]);
      setPendingJoinPlayerIds(new Set());
    }
  };

// MODIFIED: refresh includes admin name first
  const refreshTableData = async (tableId: string, source: string) => {
    console.log('[PokerTable][refresh] start', { tableId, source });
    if (!tableId) return;
    await fetchAdminName(tableId);
    await fetchPendingJoinRequests(tableId);
    const totals = await fetchTotals(tableId);
    await loadPlayersFromJoinTable(tableId, totals || {});
    await fetchBuyInHistory(tableId);
    await ensureCurrentPlayerActive(tableId);
    // NEW: load persisted end-up values so UI reflects saved values after refresh/reload
    await fetchEndUpValues(tableId);
    console.log('[PokerTable][refresh] done', { tableId, source });
  };

// REPLACED: adminName effect to rely on injected prop or fallback fetch (without duplicate logic)
  useEffect(() => {
    if (!table?.id) {
      setAdminName('');
      return;
    }
    if (table.adminName) {
      setAdminName(table.adminName);
      return;
    }
    // Fallback (initial mount before first refresh)
    fetchAdminName(table.id);
  }, [table?.id, table?.adminName]);

  // Track join-request IDs we've already shown notifications for to avoid duplicate toasts.
  // Use a Map<requestId, timestamp> with short TTL so re-subscribes within TTL won't re-show.
  const shownJoinRequestIdsRef = useRef<Map<string, number>>(new Map());
  const NOTIF_TTL_MS = 1000 * 60 * 5; // 5 minutes

  // Track player IDs that currently have a pending join_request for this table
  const [pendingJoinPlayerIds, setPendingJoinPlayerIds] = useState<Set<string>>(new Set());

  // REPLACED: old effect with inline fetchPending logic
  // useEffect(() => { ...existing fetchPending + subscription... }, [table?.id]);
  useEffect(() => {
    if (!table?.id) return;
    // DB change subscription; initial load handled by refreshTableData
    const channel = supabase
      .channel('join_requests_client_' + table.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'join_requests', filter: `table_id=eq.${table.id}` },
        () => { fetchPendingJoinRequests(table.id); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [table?.id]);

  // Recompute players whenever pending join IDs or totals change (ensures UI reflects pending state immediately)
  //  useEffect(() => {
  //    if (!table?.id) return;
  //    loadPlayersFromJoinTable(table.id, playerTotals);
  //  }, [pendingJoinPlayerIds, playerTotals, table?.id]);

  // Initial mount / table change full refresh
  useEffect(() => {
    if (table?.id) {
      refreshTableData(table.id, refreshKey !== undefined ? `refreshKey ${refreshKey}` : 'initial mount/table change');
    }
  }, [table?.id, refreshKey]);

  // New helper: fetch totals for a table and update playerTotals + players
  const fetchTotals = async (tableId?: string): Promise<Record<string, number> | null> => {
    const id = tableId || table?.id;
    if (!id) return null;
    try {
      // CHANGED: use RPC (SECURITY DEFINER) instead of direct select (RLS mismatch).
      const { data, error } = await supabase.rpc('get_table_totals', { p_table_id: id });
      console.log('[PokerTable][fetchTotals][rpc] raw', {
        error,
        rows: data?.length,
        sample: (data || []).slice(0, 5)
      });

      if (error) {
        console.warn('[PokerTable][fetchTotals][rpc] failed, attempting fallback select', error);
        // Fallback (may return 0 rows under RLS)
        const { data: fb, error: fbErr } = await supabase
          .from('buy_ins')
          .select('player_id, amount')
          .eq('table_id', id);
        if (fbErr) {
          console.error('[PokerTable][fetchTotals][fallback] failed', fbErr);
          return null;
        }
        const totals: Record<string, number> = {};
        (fb || []).forEach((r: any, idx: number) => {
          if (!r.player_id) return;
          totals[r.player_id] = (totals[r.player_id] || 0) + Number(r.amount);
        });
        prevTotalsRef.current = playerTotals;
        setPlayerTotals(totals);
        setPlayers(prev => prev.map(p => ({ ...p, totalPoints: totals[p.id] ?? 0 })));
        return totals;
      }

      const totals: Record<string, number> = {};
      (data || []).forEach((r: any, idx: number) => {
        if (!r.player_id) {
          console.warn('[PokerTable][fetchTotals][rpc] null player_id row skipped', r);
          return;
        }
        const before = totals[r.player_id] || 0;
        totals[r.player_id] = before + Number(r.total_amount);
        console.log('[PokerTable][fetchTotals][rpc] accumulate', {
          idx,
          player_id: r.player_id,
          total_amount: r.total_amount,
          before,
          after: totals[r.player_id]
        });
      });

      // Diagnostics (unchanged logic conceptually)
      const playerIds = players.map(p => p.id);
      const totalKeys = Object.keys(totals);
      const missingForPlayers = playerIds.filter(pid => !totalKeys.includes(pid));
      if (missingForPlayers.length) {
        console.warn('[PokerTable][fetchTotals][rpc] players missing totals (expected if zero buy-ins yet)', {
          tableId: id,
          missingForPlayers
        });
      }
      const orphanTotals = totalKeys.filter(k => !playerIds.includes(k));
      if (orphanTotals.length) {
        console.warn('[PokerTable][fetchTotals][rpc] totals for non-loaded players', { orphanTotals });
      }

      prevTotalsRef.current = playerTotals;
      setPlayerTotals(totals);
      console.log('[PokerTable][fetchTotals][rpc] computed totals', totals);
      setPlayers(prev => prev.map(p => ({ ...p, totalPoints: totals[p.id] ?? 0 })));
      return totals;
    } catch (e) {
      console.warn('[PokerTable][fetchTotals][rpc] exception', e);
      return null;
    }
  };

  // New helper: ensure current profile has an active table_players row (with retries),
  // clear pending markers and update players[] in-place. This tolerates realtime ordering/races.
  const ensureCurrentPlayerActive = async (tableId?: string) => {
    const id = tableId || table?.id;
    if (!id || !profile?.id) return;
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        let tpRow = null;
        try {
          const res = await retryQuery(() =>
            supabase
              .from('table_players')
              .select('status, player_id')
              .eq('table_id', id)
              .eq('player_id', profile.id)
              .limit(1)            // ADDED: constrain result set to 1 row to avoid PGRST116
              .maybeSingle()       // now safe even if duplicates exist temporarily
          );
          if (res && (res as any).error) {
            // preserve prior behavior: treat access-control as not-found
            if (isAccessControlOrTransient((res as any).error)) {
              tpRow = null;
            } else {
              throw (res as any).error;
            }
          } else {
            tpRow = (res as any).data;
          }
        } catch (e) {
          if (isAccessControlOrTransient(e)) {
            tpRow = null;
          } else {
            throw e;
          }
        }

        if (tpRow && tpRow.status === 'active') {
          // Clear pending markers for the current user
          setPendingJoinPlayerIds(prev => {
            const next = new Set(prev);
            next.delete(profile.id);
            return next;
          });
          setPendingJoinRequests(prev => prev.filter((r: any) => r.player_id !== profile.id));

          // Use updater callback to detect presence synchronously and mark active if present.
          let foundInPrev = false;
          setPlayers(prev => {
            const found = prev.some(p => p.id === profile.id);
            foundInPrev = found;
            if (found) {
              return prev.map(p => p.id === profile.id ? { ...p, active: true, pending: false } : p);
            }
            // not found -> return prev unchanged; we'll fetch & upsert below
            return prev;
          });

          // If player is missing from the list (race), fetch and inject them.
          if (!foundInPrev) {
            try {
              const { data: playerRow } = await supabase
                .from('players')
                .select('id,name')
                .eq('id', profile.id)
                .maybeSingle();
              if (playerRow) {
                setPlayers(prev => {
                  if (prev.some(p => p.id === playerRow.id)) return prev;
                  return [...prev, { id: playerRow.id, name: playerRow.name, totalPoints: playerTotals[playerRow.id] ?? 0, active: true, pending: false }];
                });
              }
            } catch (e) {
              /* ignore fetch failure */
            }
          }

          // success
          return;
        }

        await sleep(150);
      }
    } catch (e) {
      console.warn('[PokerTable] ensureCurrentPlayerActive error (ignored):', e);
    }
  };

  // Subscribe to table_players changes so we refresh players when rows are inserted/updated/deleted
  useEffect(() => {
    if (!table?.id) return;
    const ch = supabase
      .channel('table_players_' + table.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_players', filter: `table_id=eq.${table.id}` },
        async (payload) => {
          const newRow = payload?.new as any;
          const oldRow = payload?.old as any;

          // 1) Apply the changed player's status locally first (fast UI update for other viewers).
          try {
            if (newRow) {
              const changedPlayerId = newRow.player_id;
              if (changedPlayerId) {
                // Dev: if admin rejoined, log on all viewers for visibility (non-production only)
                if (process.env.NODE_ENV !== 'production' && changedPlayerId === table?.admin_player_id && newRow.status === 'active') {
                  const adminPlayer = players.find(p => p.id === changedPlayerId);
                  console.debug('[PokerTable] Admin rejoined (quick local update):', { adminId: changedPlayerId, adminName: adminPlayer?.name || null, tableId: table.id });
                }
                if (newRow.status === 'active') {
                  // clear pending markers for this player and mark active immediately
                  setPendingJoinPlayerIds(prev => {
                    const next = new Set(prev);
                    next.delete(changedPlayerId);
                    return next;
                  });
                  setPendingJoinRequests(prev => prev.filter((r: any) => r.player_id !== changedPlayerId));
                  setPlayers(prev => prev.map(p => p.id === changedPlayerId ? { ...p, active: true, pending: false } : p));
                } else if (newRow.status === 'inactive') {
                  // mark inactive locally so "Exited" appears correctly
                  setPlayers(prev => prev.map(p => p.id === changedPlayerId ? { ...p, active: false, pending: false } : p));
                }
              }
            }
          } catch (e) {
            console.error('[PokerTable] quick local update failed:', e);
          }

          // 2) Then reconcile with authoritative data to avoid races: reload players/totals and ensure current user state.
          try {
            await refreshTableData(table.id, 'table_players change');
          } catch (e) {
            console.error('[PokerTable] error reconciling after table_players change:', e);
          }

          // 3) Existing defensive flow: if current user was re-activated without a pending request, run verification.
          try {
            if (!newRow || !profile?.id) return;
            const newPlayerId = newRow.player_id;
            if (newPlayerId !== profile.id) return;
            if (profile.id === table?.admin_player_id) return; // admin allowed
            const becameActive = (newRow.status === 'active') && (oldRow?.status !== 'active');
            if (!becameActive) return;

            setTimeout(async () => {
              try {
                const { data: pendingReqs } = await supabase
                  .from('join_requests')
                  .select('*')
                  .eq('table_id', table.id)
                  .eq('player_id', profile.id)
                  .eq('status', 'pending');
                if (pendingReqs && pendingReqs.length > 0) return;
                const { data: tpRows } = await supabase
                  .from('table_players')
                  .select('*')
                  .eq('table_id', table.id)
                  .eq('player_id', profile.id);
                const tpRow = Array.isArray(tpRows) && tpRows[0];
                if (!tpRow || tpRow.status !== 'active') return;
                // revert + insert pending join_request
                try {
                  await supabase
                    .from('table_players')
                    .update({ status: 'inactive' })
                    .match({ table_id: table.id, player_id: profile.id });
                } catch (e) { console.warn('[PokerTable] Failed to set table_players to inactive (ignored):', e); }
                try {
                  const existing = await supabase
                    .from('join_requests')
                    .select('id')
                    .eq('table_id', table.id)
                    .eq('player_id', profile.id)
                    .maybeSingle();
                  if (!existing.data) {
                    await supabase.from('join_requests').insert({
                      id: uuidv4(),
                      table_id: table.id,
                      player_id: profile.id,
                      status: 'pending',
                      created_at: new Date().toISOString()
                    });
                  }
                } catch (e) { console.warn('[PokerTable] Failed to insert join_request (ignored):', e); }
                try {
                  const { data: freshPending } = await supabase
                    .from('join_requests')
                    .select('player_id')
                    .eq('table_id', table.id)
                    .eq('status', 'pending');
                  setPendingJoinPlayerIds(new Set((freshPending || []).map((r: any) => r.player_id).filter(Boolean)));
                } catch (e) { /* ignore */ }
                await loadPlayersFromJoinTable(table.id, playerTotals);
                await fetchTotals(table.id);
                toast('Join request created', { description: 'Admin approval is required to re-join this table.' });
              } catch (e) {
                console.error('[PokerTable] Error verifying re-activation:', e);
              }
            }, 800);
          } catch (e) {
            console.error('[PokerTable] table_players subscription handler error:', e);
          }
        }
      )
      .subscribe();

     return () => {
       supabase.removeChannel(ch);
     };
   }, [table?.id, profile?.id]);

  // Auto-approve rejoin for returning players:
  useEffect(() => {
    if (!table?.id) return;
    const ch = supabase
      .channel('join_requests_auto_' + table.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'join_requests', filter: `table_id=eq.${table.id}` },
        async (payload) => {
          try {
            const newReq = payload?.new;
            if (!newReq) return;
            const playerId = newReq.player_id;
            if (!playerId) return;

            // Check prior membership
            let prior = null;
            try {
              const { data: priorData, error: priorErr } = await supabase
                .from('table_players')
                .select('*')
                .eq('table_id', table.id)
                .eq('player_id', playerId)
                .maybeSingle();
              if (!priorErr) prior = priorData;
            } catch { /* ignore */ }

            if (prior) {
              try {
                await safeUpsertTablePlayer(table.id, playerId, 'active');
                await supabase.from('join_requests').delete().eq('id', newReq.id);
                shownJoinRequestIdsRef.current.set(newReq.id, Date.now());
                await refreshTableData(table.id, 'auto-approve returning player');
                // Notify player
                try {
                  await supabase
                    .channel('user_' + playerId)
                    .send({
                      type: 'broadcast',
                      event: 'join_approved',
                      payload: { tableId: table.id }
                    });
                } catch { /* ignore */ }
                // Local pending cleanup
                setPendingJoinRequests(prev => prev.filter(r => r.id !== newReq.id));
                setPendingJoinPlayerIds(prev => {
                  const next = new Set(prev);
                  next.delete(playerId);
                  return next;
                });
              } catch (e) {
                console.error('[PokerTable] auto-approve join_request handler error:', e);
              }
            }
          } catch (e) {
            console.error('[PokerTable] auto-approve join_request handler error (outer):', e);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table?.id]);

  // --- New: buy-in request (bonding) admin flow ---
  useEffect(() => {
    if (!table?.id || !isAdmin) return;

    let mounted = true;
    const fetchPendingBuyIns = async () => {
      try {
        const res = await retryQuery(() =>
          supabase
            .from('buy_in_requests')
            .select('*')
            .eq('table_id', table.id)
            .eq('status', 'pending')
        );
        const { data, error } = res as any;
        if (!mounted) return;
        if (!error) setPendingRequests(data || []);
        else setPendingRequests([]);
      } catch (e) {
        if (!mounted) return;
        setPendingRequests([]);
      }
    };
    fetchPendingBuyIns();

    const ch = supabase
      .channel('user_' + profile.id)
      .on('broadcast', { event: 'buy_in_request_created' }, async (payload) => {
        try {
          // dedupe by request id so repeated broadcasts are ignored
          const reqId = payload?.payload?.requestId;
          if (!reqId) return;
          const shownMap = shownJoinRequestIdsRef.current;
          const prevTs = shownMap.get(reqId);
          if (prevTs && (Date.now() - prevTs) < NOTIF_TTL_MS) return;
          shownMap.set(reqId, Date.now());

          // show toast and refresh pending buy-in requests
          toast('New buy-in request', { description: `${payload?.payload?.playerName || 'A player'} requested a buy-in` });
          const { data: reqs, error } = await supabase
            .from('buy_in_requests')
            .select('*')
            .eq('table_id', table.id)
            .eq('status', 'pending');
          if (error || !reqs) {
            setPendingRequests([]);
            return;
          }
          setPendingRequests(reqs || []);
        } catch (e) {
          console.error('[PokerTable] buy_in_request_created handler error:', e);
        }
      })
      // ADDED: listen for join request broadcasts (quick toast + refresh pending list)
      .on('broadcast', { event: 'join_request_created' }, async (payload) => {
        try {
          const reqId = payload?.payload?.requestId;
            if (!reqId) return;
          const shownMap = shownJoinRequestIdsRef.current;
          const prevTs = shownMap.get(reqId);
          if (prevTs && (Date.now() - prevTs) < NOTIF_TTL_MS) return;
          shownMap.set(reqId, Date.now());
          toast('New join request', {
            description: `${payload?.payload?.playerName || 'A player'} wants to join`
          });
          await fetchPendingJoinRequests(table.id);
        } catch (e) {
          console.warn('[PokerTable] join_request_created broadcast handler failed', e);
        }
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [table?.id, isAdmin, profile?.id]);

  // New helper: fetch buy-in history (shared)
  const fetchBuyInHistory = async (tableId?: string) => {
    const id = tableId || table?.id;
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('buy_ins')
        .select('player_id, amount, timestamp')
        .eq('table_id', id)
        .order('timestamp', { ascending: false });
      if (!error) {
        setHistoryData(data || []);
        console.log('[PokerTable][fetchBuyInHistory] loaded', { count: (data || []).length });
      }
    } catch (e) {
      console.warn('[PokerTable][fetchBuyInHistory] error', e);
    }
  };

  // --- Realtime: subscribe to buy_ins changes so totals/history update live for all clients ---
  useEffect(() => {
    if (!table?.id) return;
    const ch = supabase
      .channel('buy_ins_' + table.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buy_ins', filter: `table_id=eq.${table.id}` },
        async (payload) => {
          const ts = new Date().toISOString();
          console.log('[PokerTable][realtime][buy_ins] change received', {
            tableId: table.id,
            ts,
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
            prevTotals: prevTotalsRef.current
          });
          try {
            await refreshTableData(table.id, 'buy_ins change');
            console.log('[PokerTable][realtime][buy_ins] post-refresh totals', playerTotals);
          } catch (e) {
            console.warn('[PokerTable] buy_ins realtime handler failed (ignored):', e);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table?.id, players]); // include players so missing players detection stays current

  // NEW / EXTENDED: explicit broadcast channel so participants refresh (already existed for buy_in_updated)
  useEffect(() => {
    if (!table?.id) return;
    const bc = supabase
      .channel('table_' + table.id)
      .on('broadcast', { event: 'buy_in_updated' }, async (payload) => {
        console.log('[PokerTable][broadcast][buy_in_updated] received', payload);
        try {
          await refreshTableData(table.id, 'broadcast:buy_in_updated');
        } catch (e) {
          console.warn('[PokerTable] broadcast buy_in_updated refresh failed', e);
        }
      })
      .on('broadcast', { event: 'join_refresh' }, async (payload) => {
        console.log('[PokerTable][broadcast][join_refresh] received', payload);
        try {
          await refreshTableData(table.id, 'broadcast:join_refresh');
          // If the updated player is the admin, fetch and update admin name
          if (payload?.updatedPlayer === normalizedAdminId) {
            await fetchAdminName(table.id);
          }
        } catch (e) {
          console.warn('[PokerTable] broadcast join_refresh refresh failed', e);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(bc); };
  }, [table?.id, normalizedAdminId]);

  // DIAG: log player list & totals correlation each time players or totals change
  useEffect(() => {
    const correlated = players.map(p => ({
      id: p.id,
      name: p.name,
      active: p.active,
      pending: p.pending,
      totalPointsField: p.totalPoints,
      totalFromMap: playerTotals[p.id] ?? 0
    }));
    console.log('[PokerTable][players/totals change]', {
      tableId: table?.id,
      correlated,
      totalsKeys: Object.keys(playerTotals),
      totalsRaw: playerTotals
    });
  }, [players, playerTotals]);

  // Handler to request a buy-in from a player (used by the Buy-in dialog)
  const handleRequestBuyIn = async () => {
    if (!table || !profile) return;
    if (processingBuyIn) {
      // already submitting
      return;
    }
    setProcessingBuyIn(true);
    console.log('[PokerTable][handleRequestBuyIn] submitting request', {
      tableId: table.id,
      playerId: profile.id,
      amount
    });

    const buyInReq = {
      id: uuidv4(),
      table_id: table.id,
      player_id: profile.id,
      amount: parseFloat(amount || '0'),
      status: 'pending',
      created_at: new Date().toISOString()
    };

    try {
      const { error } = await supabase.from('buy_in_requests').insert(buyInReq);
      if (error) {
        console.error('[PokerTable] Failed to insert buy_in_request:', error);
        toast.error('Failed to request buy-in.');
        return;
      }
      // Notify admin (best-effort)
      try {
        const adminId = table?.admin_player_id ?? (table as any)?.adminId;
        if (adminId) {
          await supabase
            .channel('user_' + adminId)
            .send({
              type: 'broadcast',
              event: 'buy_in_request_created',
              payload: { requestId: buyInReq.id, playerName: profile?.name, tableId: table.id }
            });
        }
      } catch (e) {
        console.warn('[PokerTable] buy_in_request broadcast failed (ignored):', e);
      }

      // Admin local refresh + admin-specific toast
      if (isAdmin) {
        try {
          const { data: reqs, error: fetchErr } = await supabase
            .from('buy_in_requests')
            .select('*')
            .eq('table_id', table.id)
            .eq('status', 'pending');
          if (!fetchErr) setPendingRequests(reqs || []);
        } catch (e) {
          console.warn('[PokerTable] failed to refresh pending buy_in_requests for admin (ignored):', e);
        }
        toast('New buy-in request', { description: `${profile?.name || 'You'} requested a buy-in` });
      }

      toast.success('Buy-in request sent', {
        description: 'The table admin has been notified.'
      });

      // Reset processing state after successful request
      processingBuyInRef.current = false;
      setProcessingBuyIn(false);
      setOpenBuyIn(false);
      setAmount('');
    } catch (e) {
      console.error('[PokerTable] Exception inserting buy_in_request:', e);
      toast.error('Failed to request buy-in.');
      // Reset on error as well
      processingBuyInRef.current = false;
      setProcessingBuyIn(false);
    }
  };

// Handler for requesting to join a table (regular players)
const handleRequestJoin = async () => {
  const playerId = profile?.id;
  if (!table?.id || !playerId) {
    toast.error('Cannot join: missing table or profile info.');
    console.error('[PokerTable.handleRequestJoin] Aborted: missing table or profile ID.', { tableId: table?.id, playerId });
    return;
  }
  if (processingJoinRequestLocal) {
    return;
  }

  console.log(`[PokerTable.handleRequestJoin] User ${playerId} is requesting to join table ${table.id}.`);

  // Check if player is already in the table_players list
  const { data: tpRow, error: tpError } = await supabase
    .from('table_players')
    .select('id, status')
    .eq('table_id', table.id)
    .eq('player_id', playerId)
    .maybeSingle();

  if (tpError) {
    console.error('[PokerTable.handleRequestJoin] Error checking table_players:', tpError);
    toast.error('Database error checking player status.');
    return;
  }

  if (tpRow) {
    console.log(`[PokerTable.handleRequestJoin] User ${playerId} is a returning player. Status: ${tpRow.status}. Activating.`);
    // If already in table_players, just activate (no approval needed)
    await safeUpsertTablePlayer(table.id, playerId, 'active');
    await refreshTableData(table.id, 'rejoin');
    // broadcast so other clients see the player list update
    try {
      await supabase.channel('table_' + table.id).send({
        type: 'broadcast',
        event: 'join_refresh',
        payload: { rejoinedPlayer: playerId }
      });
    } catch (e) { console.warn('[PokerTable] rejoin broadcast failed', e); }
    toast('You have rejoined the table.');
    return;
  }

  console.log(`[PokerTable.handleRequestJoin] User ${playerId} is a new player for this table. Checking for existing requests.`);

  // If there's already a pending join_request, update local pending state and exit.
  const { data: existingReq, error: existingReqError } = await supabase
    .from('join_requests')
    .select('id, status')
    .eq('table_id', table.id)
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .maybeSingle();

  if (existingReqError) {
    console.error('[PokerTable.handleRequestJoin] Error checking existing join_requests:', existingReqError);
    toast.error('Database error checking join requests.');
    return;
  }

  if (existingReq) {
    console.log(`[PokerTable.handleRequestJoin] User ${playerId} already has a pending request (ID: ${existingReq.id}). Not creating a new one.`);
    // ensure UI shows pending immediately
    setPendingJoinPlayerIds(prev => {
      const next = new Set(prev);
      next.add(playerId);
      return next;
    });
    toast('Your join request is still pending.');
    return;
  }

  console.log(`[PokerTable.handleRequestJoin] No pending request found for user ${playerId}. Creating a new join request.`);

  // Create a new join request
  try {
    setProcessingJoinRequestLocal(true);
    // optimistic UI: mark as pending immediately to avoid double-click race
    setPendingJoinPlayerIds(prev => {
      const next = new Set(prev);
      next.add(playerId);
      return next;
    });
    const newRequestId = uuidv4();
    const { error: insertError } = await supabase
      .from('join_requests')
      .insert({
        id: newRequestId,
        table_id: table.id,
        player_id: playerId,
        status: 'pending',
        created_at: new Date().toISOString()
      });
    if (insertError) {
      console.error('[PokerTable] insert join_request failed:', insertError);
      // revert optimistic pending marker
      setPendingJoinPlayerIds(prev => {
        const next = new Set(prev);
        next.delete(playerId);
        return next;
      });
      toast('Failed to create join request');
      return;
    }

    // Best-effort: notify admin so they get a quick UI prompt (non-fatal)
    try {
      const adminId = normalizedAdminId; // CHANGED: use normalized admin id (handles camelCase)
      if (adminId) {
        await supabase
          .channel('user_' + adminId)
          .send({
            type: 'broadcast',
            event: 'join_request_created',
            payload: { requestId: newRequestId, playerName: profile?.name, tableId: table.id }
          });
      }
    } catch (e) {
      console.warn('[PokerTable] join_request broadcast to admin failed (ignored):', e);
    }

    // Update local pending markers so UI shows the pending state immediately
    setPendingJoinRequests(prev => [...prev, { id: newRequestId, player_id: playerId, player_name: profile.name }]);
    toast('Join request sent');
  } catch (e) {
    console.error('[PokerTable] handleRequestJoin error:', e);
    // revert optimistic pending marker on unexpected error
    setPendingJoinPlayerIds(prev => {
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
    toast('Failed to send join request');
  } finally {
    setProcessingJoinRequestLocal(false);
  }
};

// ADDED: handle player exiting the game
const handleExitGame = async () => {
  if (!table?.id || !profile?.id) return;
  setProcessingExit(true);
  try {
    // Set player status to inactive in the table_players table
    await supabase
      .from('table_players')
      .update({ status: 'inactive' })
      .match({ table_id: table.id, player_id: profile.id });

    // Broadcast a refresh event so other players see the change
    await supabase
      .channel('table_' + table.id)
      .send({
        type: 'broadcast',
        event: 'join_refresh',
        payload: { exitedPlayer: profile.id }
      });

    // Clear local state and navigate away by calling the onExit prop
    onExit();
    toast('You have left the table.');
  } catch (error) {
    console.error('Error exiting game:', error);
    toast.error('Failed to exit table. Please try again.');
  } finally {
    setProcessingExit(false);
  }
};

// ---------------------- Inserted helpers & admin handlers ----------------------
// (Adds previously-omitted helpers that many handlers/hooks reference.)

// small detector for access-control / transient fetch errors
const isAccessControlOrTransient = (err: any) => {
  if (!err) return false;
  const msg = (err?.message || '').toString().toLowerCase();
  if (msg.includes('access control') || msg.includes('permission') || msg.includes('forbidden')) return true;
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) return true;
  if (msg.includes('blocked by cors') || msg.includes('cors') || msg.includes('access-control-allow-origin')) return true;
  if (err instanceof TypeError) return true;
  return false;
};

// Retry wrapper for supabase queries to tolerate transient/access-control errors
const retryQuery = async <T,>(fn: () => Promise<T>, retries = 3, baseDelay = 150): Promise<T> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isAccessControlOrTransient(err) || attempt === retries - 1) throw err;
      // exponential backoff
      await new Promise(res => setTimeout(res, baseDelay * Math.pow(2, attempt)));
    }
  }
  // unreachable
  throw new Error('retryQuery failed unexpectedly');
};

// safe upsert for table_players: insert -> update -> last-resort upsert
const safeUpsertTablePlayer = async (tableId: string, playerId: string, status: 'active' | 'inactive') => {
  if (!tableId || !playerId) return;
  try {
    const { error } = await supabase
      .from('table_players')
      .upsert(
        { table_id: tableId, player_id: playerId, status },
        { onConflict: 'table_id,player_id' } // relies on UNIQUE(table_id, player_id)
      );
    if (error) {
      console.warn('[PokerTable] safeUpsertTablePlayer upsert failed:', error);
    }
  } catch (e) {
    console.warn('[PokerTable] safeUpsertTablePlayer threw (ignored):', e);
  }
};

// Lightweight loader for players joined to a table (used by many hooks)
// Keeps behaviour simple: load table_players rows then player profiles and setPlayers.
const loadPlayersFromJoinTable = async (tableId: string, totals: Record<string, number>) => {
  console.log('[PokerTable][loadPlayersFromJoinTable] start', { tableId });
  if (!tableId) return;
  try {
    const joinRes: any = await retryQuery(() =>
      supabase.from('table_players').select('player_id,status').eq('table_id', tableId)
    );
    const joinRows = joinRes.data || [];
    const ids = Array.from(new Set(joinRows.map((r: any) => r.player_id).filter(Boolean)));
    if (ids.length === 0) {
      setPlayers([]);
      console.log('[PokerTable][loadPlayersFromJoinTable] no players');
      return;
    }
    const playersRes: any = await retryQuery(() => supabase.from('players').select('id,name').in('id', ids));
    const playersData = playersRes.data || [];
    const statusById: Record<string, string> = {};
    joinRows.forEach((r: any) => { statusById[r.player_id] = r.status; });
    const nextPlayers: TablePlayer[] = playersData.map((p: any) => ({
      id: p.id,
      name: p.name,
      totalPoints: totals[p.id] ?? 0,
      active: statusById[p.id] === 'active',
      pending: pendingJoinPlayerIds.has(p.id)
    }));
    console.log('[PokerTable][loadPlayersFromJoinTable] built player list', nextPlayers);
    setPlayers(nextPlayers);
  } catch (e) {
    console.error('[PokerTable][loadPlayersFromJoinTable] error', e);
  }
};

// Admin handlers for buy-in requests
const handleApprove = async (reqId: string) => {
  console.log('[PokerTable][handleApprove] start', { reqId, tableId: table?.id });
  if (!reqId || processingRequests.includes(reqId) || !table) return;
  setProcessingRequests(prev => [...prev, reqId]);
  try {
    const { data, error } = await supabase.rpc('approve_buy_in', { p_request_id: reqId });
    if (error) {
      console.error('[PokerTable][handleApprove] RPC error', error);
      throw error;
    }
    console.log('[PokerTable][handleApprove] RPC inserted buy_in id', data);

    setPendingRequests(prev => prev.filter(r => r.id !== reqId));

    await refreshTableData(table.id, 'handleApprove (rpc)');

    // NEW: broadcast to table participants (regular users listen and refresh)
    try {
      await supabase
        .channel('table_' + table.id)
        .send({
          type: 'broadcast',
          event: 'buy_in_updated',
          payload: { by: profile?.id, buyInId: data }
        });
    } catch (e) {
      console.warn('[PokerTable][handleApprove] broadcast failed (ignored)', e);
    }

    toast('Buy-in approved');
  } catch (e) {
    console.error('[PokerTable] handleApprove error:', e);
    toast('Failed to approve buy-in');
  } finally {
    setProcessingRequests(prev => prev.filter(id => id !== reqId));
  }
};

const handleReject = async (reqId: string) => {
  if (!reqId || processingRequests.includes(reqId) || !table) return;
  setProcessingRequests(prev => [...prev, reqId]);
  try {
    // delete the request (no points applied)
    await supabase.from('buy_in_requests').delete().eq('id', reqId);
    const { data } = await supabase.from('buy_in_requests').select('*').eq('table_id', table.id).eq('status', 'pending');
    setPendingRequests(data || []);

    // notify the player (best-effort)
    try {
      // we can try to look up the player id from the removed row via rpc or prior state;
      // skip detailed notify to avoid additional queries here (admin UI shows rejection).
    } catch (e) { /* ignore */ }

    toast('Buy-in rejected');
  } catch (e) {
    console.error('[PokerTable] handleReject error:', e);
    toast('Failed to reject buy-in');
  } finally {
    setProcessingRequests(prev => prev.filter(id => id !== reqId));
  }
};

// --- New: Admin handlers for join requests (approve/reject) ---
const handleApproveJoin = async (reqId: string) => {
  if (!reqId || processingJoinRequests.includes(reqId) || !table) return;
  setProcessingJoinRequests(prev => [...prev, reqId]);
  try {
    const { data: reqRow, error } = await supabase
      .from('join_requests')
      .select('*')
      .eq('id', reqId)
      .maybeSingle();
    if (error || !reqRow) throw new Error('join_request not found');

    const playerId = reqRow.player_id;
    if (!playerId) throw new Error('join_request missing player_id');

    try {
      await safeUpsertTablePlayer(table.id, playerId, 'active');
    } catch (e) {
      console.warn('[PokerTable] safeUpsertTablePlayer (approve join) failed (ignored):', e);
    }

    try {
      await supabase.from('join_requests').delete().eq('id', reqId);
    } catch (e) {
      console.warn('[PokerTable] Failed to delete join_request after approve (ignored):', e);
    }

    // Centralized refresh instead of manual totals aggregation
    await refreshTableData(table.id, 'handleApproveJoin');

    setPendingJoinRequests(prev => prev.filter((r: any) => r.id !== reqId));
    setPendingJoinPlayerIds(prev => {
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });

    try {
      await supabase
        .channel('user_' + playerId)
        .send({
          type: 'broadcast',
          event: 'join_approved',
          payload: { tableId: table.id }
        });
    } catch (e) {
      console.warn('[PokerTable] notify join_approved failed (ignored):', e);
    }

    toast('Join request approved');
    // ADDED: broadcast lightweight join refresh event so all clients refresh players/totals quickly
    try {
      await supabase
        .channel('table_' + table.id)
        .send({
          type: 'broadcast',
          event: 'join_refresh',
          payload: { approvedPlayer: playerId }
        });
    } catch (e) {
      console.warn('[PokerTable] join_refresh broadcast failed (ignored)', e);
    }
  } catch (e) {
    console.error('[PokerTable] handleApproveJoin error:', e);
    toast('Failed to approve join request');
  } finally {
    setProcessingJoinRequests(prev => prev.filter(id => id !== reqId));
  }
};

const handleRejectJoin = async (reqId: string) => {
  if (!reqId || processingJoinRequests.includes(reqId) || !table) return;
  setProcessingJoinRequests(prev => [...prev, reqId]);
  try {
    // fetch the join_request so we can notify the player
    const { data: reqRow, error } = await supabase
      .from('join_requests')
      .select('*')
      .eq('id', reqId)
      .maybeSingle();

    // delete the join_request (no membership change)
    try {
      await supabase.from('join_requests').delete().eq('id', reqId);
    } catch (e) {
      console.warn('[PokerTable] Failed to delete join_request on reject (ignored):', e);
    }

    // refresh pending list locally
    try {
      const { data: pending } = await supabase
        .from('join_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      setPendingJoinRequests(pending || []);
      const ids = new Set((pending || []).map((r: any) => r.player_id).filter(Boolean));
      setPendingJoinPlayerIds(ids);
    } catch (e) {
      // ignore
    }

    // notify the player (best-effort)
    try {
      const playerId = reqRow?.player_id;
      if (playerId) {
        await supabase
          .channel('user_' + playerId)
          .send({
            type: 'broadcast',
            event: 'join_rejected',
            payload: { tableId: table.id }
          });
      }
    } catch (e) {
      console.warn('[PokerTable] notify join_rejected failed (ignored):', e);
    }

    toast('Join request rejected');
  } catch (e) {
    console.error('[PokerTable] handleRejectJoin error:', e);
    toast('Failed to reject join request');
  } finally {
    setProcessingJoinRequests(prev => prev.filter(id => id !== reqId));
  }
};

const [openEditProfile, setOpenEditProfile] = useState(false);
const [editName, setEditName] = useState(profile?.name || '');
const [editError, setEditError] = useState('');
const [editSubmitting, setEditSubmitting] = useState(false);

const handleEditNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setEditName(e.target.value);
  setEditError('');
};

const handleEditProfileSubmit = async () => {
  if (!editName.trim()) {
    setEditError('Please enter your name.');
    return;
  }
  setEditSubmitting(true);
  try {
    // Check for existing name (case-insensitive, excluding current user)
    const { data: existingPlayers, error } = await supabase
      .from('players')
      .select('id,name')
      .ilike('name', editName.trim());

    if (error) {
      setEditError('Error checking name. Please try again.');
      setEditSubmitting(false);
      return;
    }

    // Exclude current user's own name from the check
    const nameTaken = (existingPlayers || []).some(
      (p: any) => p.name?.toLowerCase() === editName.trim().toLowerCase() && p.id !== profile?.id
    );

    if (nameTaken) {
      setEditError('This name already exists. Please provide a new name.');
      setEditName('');
      setEditSubmitting(false);
      return;
    }

    await supabase
      .from('players')
      .update({ name: editName.trim() })
      .eq('id', profile?.id);

    storage.setProfile({ ...profile, name: editName.trim() });

    // If current user is admin, update adminName state immediately
    if (profile?.id === normalizedAdminId) {
      setAdminName(editName.trim());
    }

    setEditSubmitting(false);
    setOpenEditProfile(false);
    toast.success('Profile updated!');

    await supabase
      .channel('table_' + table.id)
      .send({
        type: 'broadcast',
        event: 'join_refresh',
        payload: { updatedPlayer: profile?.id }
      });

    await refreshTableData(table.id, 'edit profile');
  } catch (error) {
    setEditError('Failed to update profile. Please try again.');
    setEditSubmitting(false);
  }
};

// ADD: load persisted end-up values for a table
const fetchEndUpValues = async (tableId?: string) => {
  const id = tableId || table?.id;
  if (!id) return;
  try {
    const { data, error } = await supabase
      .from('end_ups')
      .select('player_id, value')
      .eq('table_id', id);
    if (error) {
      console.warn('[PokerTable][fetchEndUpValues] failed', error);
      return;
    }
    const map: Record<string, number> = {};
    (data || []).forEach((r: any) => {
      if (!r || !r.player_id) return;
      map[r.player_id] = Number(r.value || 0);
    });
    setEndUpValues(map);
    console.log('[PokerTable][fetchEndUpValues] loaded', { tableId: id, count: Object.keys(map).length });
  } catch (e) {
    console.error('[PokerTable][fetchEndUpValues] exception', e);
  }
};

// REPLACE: Admin action now persists to DB and broadcasts
const handleSaveEndUp = async () => {
  if (!table?.id) return;
  try {
    // Prepare rows for upsert: one row per player with numeric value
    const rows = Object.keys(endUpValues).map(pid => ({
      table_id: table.id,
      player_id: pid,
      value: Number(endUpValues[pid] ?? 0),
      updated_at: new Date().toISOString()
    }));

    if (rows.length > 0) {
      // Upsert using composite unique on (table_id, player_id)
      const { error } = await supabase
        .from('end_ups')
        .upsert(rows, { onConflict: 'table_id,player_id' });
      if (error) {
        console.error('[PokerTable] handleSaveEndUp upsert failed', error);
        toast.error('Failed to save end-up values.');
        return;
      }
    } else {
      // If admin cleared all values locally, delete persisted rows for this table
      try {
        await supabase.from('end_ups').delete().eq('table_id', table.id);
      } catch (e) { /* ignore */ }
    }

    // Broadcast so other clients update quickly (they listen for end_up_updated)
    try {
      await supabase
        .channel('table_' + table.id)
        .send({
          type: 'broadcast',
          event: 'end_up_updated',
          payload: { endUpValues }
        });
    } catch (e) {
      console.warn('[PokerTable] handleSaveEndUp broadcast failed (ignored)', e);
    }

    toast.success('End-up values saved and broadcasted.');
  } catch (e) {
    console.error('[PokerTable] handleSaveEndUp failed', e);
    toast.error('Failed to save end-up values.');
  }
};

// Listen for end_up updates so all clients reflect admin-provided values
useEffect(() => {
  if (!table?.id) return;
  const ch = supabase
    .channel('table_' + table.id)
    .on('broadcast', { event: 'end_up_updated' }, (payload) => {
      try {
        const values = payload?.payload?.endUpValues || {};
        console.log('[PokerTable][broadcast][end_up_updated] received', { tableId: table.id, values });
        setEndUpValues(values);
      } catch (e) {
        console.warn('[PokerTable] end_up_updated handler failed', e);
      }
    })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [table?.id]);

return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-cover"
      style={{
        backgroundImage: "url('/Poker_06.png')",
        backgroundPosition: 'center 85%', // Explicitly shifts the image up. Adjust 85% to fine-tune.
      }}
    >
      <Card className="w-full max-w-2xl bg-black/70 backdrop-blur-sm border border-green-400/50 shadow-lg text-gray-100">
        <CardHeader>
          <CardTitle className="text-white">
            Poker Table: {table.name || normalizedJoinCode}
          </CardTitle>
          <CardDescription className="text-gray-300">
            Join Code: <span className="font-bold text-yellow-300">{normalizedJoinCode}</span> <br />
            {/* FIX: prefer local adminName state first so admin sees immediate updates */}
            Admin: <span className="font-semibold text-white">{adminName || table.adminName || 'Loading...'}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* ADDED: Show "Request to Join" button if not a player and not pending */}
          {!isPlayerOnTable && !pendingJoinPlayerIds.has(profile?.id || '') && (
            <div className="mb-6 p-4 border rounded-lg bg-black/50 border-blue-400/50">
              <h3 className="font-semibold text-lg mb-2 text-white">You are viewing this table as a spectator.</h3>
              {/* If profile is missing, explain cause & recovery */}
              {!profile && (
                <p className="text-sm text-yellow-300 mb-2">
                  Your local profile or table selection is missing. This happens if you cleared browser storage/cache or restarted the device — it removes only the local identity and selection. Server data (tables, players, join requests, buy-ins, end-up values) is still intact.
                  To recover: open Onboarding to recreate your profile, then request to join this table or ask the admin to re-add your player row.
                </p>
              )}
              {/* NEW: magic link explanation for authenticated users */}
              {/*
                If the user signed up using an email magic-link (or another auth provider),
                clicking the sign-in link later will restore the same server-linked profile
                (Jack) on any device where you complete the sign-in. Magic links create an
                auth session that persists until it expires or you sign out. If you used the
                anonymous/no-auth flow instead, save a recovery token or sign in with email
                to enable cross-device/profile recovery.
              */}
              {(!profile && false) && null}
              <p className="text-sm text-gray-300 mb-4">To participate, request to join. The admin will need to approve your request.</p>
              <Button
                onClick={handleRequestJoin}
                className="w-full"
                variant="hero"
                disabled={processingJoinRequestLocal || pendingJoinPlayerIds.has(profile?.id || '')}
              >
                <span role="img" aria-label="join">👋</span> Request to Join Table
              </Button>
            </div>
          )}

          {/* Show main content only if the user is a player on the table */}
          {isPlayerOnTable && (
            <>
              {/* Buy-in request section */}
              <div className="mb-6 flex gap-2 items-center flex-wrap">
                {/* Buy-in button (always visible) */}
                <Dialog open={openBuyIn} onOpenChange={setOpenBuyIn}>
                  <DialogTrigger asChild>
                    <Button
                      variant="hero"
                      className="px-2 py-1 min-w-[70px] text-[13px] rounded shadow-sm bg-green-600 hover:bg-green-700 text-white flex items-center gap-1 transition-all"
                    >
                      <span role="img" aria-label="buy-in">💸</span>
                      Buy-in
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-gray-900/90 backdrop-blur-md border-white/20 text-white">
                    <DialogHeader>
                      <DialogTitle>Request Buy-in</DialogTitle>
                    </DialogHeader>
                    {/* Use a form so Enter key submits */}
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        // synchronous guard prevents double-submit before state updates
                        if (processingBuyInRef.current || !amount.trim()) return;
                        processingBuyInRef.current = true;
                        setProcessingBuyIn(true);
                        handleRequestBuyIn();
                      }}
                      className="space-y-2"
                    >
                      <Label htmlFor="amount">Amount (can be positive or negative)</Label>
                      <Input
                        id="amount"
                        type="number"
                        inputMode="decimal"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        className="bg-white/10 border-white/30 text-white placeholder-gray-400 focus:ring-white/50"
                        autoFocus
                      />
                      <DialogFooter>
                        <Button type="submit" disabled={processingBuyInRef.current || !amount.trim()}>
                          {processingBuyIn ? 'Sending...' : 'Submit'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>

                {/* History button (always visible, comes after buy-in request) */}
                <HistoryDialog open={openHistory} onOpenChange={setOpenHistory}>
                  <HistoryDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="px-2 py-1 min-w-[70px] text-[13px] rounded shadow-sm bg-blue-600 hover:bg-blue-700 text-white border-none flex items-center gap-1 transition-all"
                    >
                      <span role="img" aria-label="history">📜</span>
                      History
                    </Button>
                  </HistoryDialogTrigger>
                  <HistoryDialogContent
                    className="bg-gray-900/90 backdrop-blur-md border-white/20 text-white"
                    style={{ minWidth: 350, maxWidth: 600 }}
                  >
                    <HistoryDialogHeader>
                      <HistoryDialogTitle>Buy-in History</HistoryDialogTitle>
                    </HistoryDialogHeader>
                    <div style={{
                      fontSize: '11px',
                      overflowX: 'auto',
                      overflowY: 'auto',
                      maxHeight: '60vh'
                    }}>
                      <UITable>
                        <TableHeader>
                          <TableRow>
                            <TableHead style={{ minWidth: 60, padding: '2px 4px' }}>Player</TableHead>
                            {(() => {
                              const playerBuyIns = players.map((p: any) =>
                                historyData.filter((row: any) => row.player_id === p.id)
                              );
                              const maxBuyIns = playerBuyIns.length ? Math.max(...playerBuyIns.map(arr => arr.length)) : 0;
                              return Array.from({ length: maxBuyIns }).map((_, idx) => (
                                <TableHead key={idx} style={{ minWidth: 40, padding: '2px 4px', textAlign: 'center' }}>
                                  {idx + 1}
                                </TableHead>
                              ));
                            })()}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {players.map((p: any) => {
                            const buyIns = historyData
                              .filter((row: any) => row.player_id === p.id)
                              .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                            return (
                              <TableRow key={p.id}>
                                <TableCell style={{ minWidth: 60, padding: '2px 4px' }}>{p.name}</TableCell>
                                {buyIns.map((row: any, idx: number) => (
                                  <TableCell key={idx} style={{ minWidth: 40, padding: '2px 4px', textAlign: 'center' }}>
                                    {parseInt(row.amount, 10)}
                                  </TableCell>
                                ))}
                                {Array.from({ length: Math.max(0, (() => {
                                  const playerBuyIns = players.map((pl: any) =>
                                    historyData.filter((row: any) => row.player_id === pl.id)
                                  );
                                  const maxBuyIns = playerBuyIns.length ? Math.max(...playerBuyIns.map(arr => arr.length)) : 0;
                                  return maxBuyIns - buyIns.length;
                                })()) }).map((_, idx) => (
                                  <TableCell key={`empty-${idx}`} style={{ minWidth: 40, padding: '2px 4px' }}></TableCell>
                                ))}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </UITable>
                    </div>
                    <HistoryDialogFooter>
                      <Button variant="secondary" onClick={() => setOpenHistory(false)}>Close</Button>
                    </HistoryDialogFooter>
                  </HistoryDialogContent>
                </HistoryDialog>

                {/* End Up button (visible to all players; inputs editable only by admin) */}
                {(() => {
                  // show End Up button to everyone (admin edits, regular users read-only)
                  if (!isAdmin) {
                    console.log('[PokerTable.UI] End Up visible (read-only) for regular player', { profileId: profile?.id });
                  } else {
                    console.log('[PokerTable.UI] End Up visible (editable) for admin', { profileId: profile?.id });
                  }
                  return true;
                })() && (
                  <Dialog open={openEndUp} onOpenChange={setOpenEndUp}>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="px-2 py-1 min-w-[70px] text-[13px] rounded shadow-sm bg-purple-600 hover:bg-purple-700 text-white border-none flex items-center gap-1 transition-all"
                      >
                        <span role="img" aria-label="end-up">🏁</span>
                        End Up
                      </Button>
                    </DialogTrigger>
                    <DialogContent
                      className="bg-gray-900/90 backdrop-blur-md border-white/20 text-white"
                      style={{
                        display: 'inline-block',
                        padding: '4px',
                        minHeight: '700px',
                        maxHeight: '100vh'
                      }}
                    >
                      <DialogHeader>
                        <DialogTitle>End Up Game</DialogTitle>
                      </DialogHeader>
                      <div
                        style={{
                          fontSize: '10px',
                          height: '600px',
                          maxHeight: '80vh',
                          overflowX: 'auto',
                          overflowY: 'auto',
                          padding: '0'
                        }}
                      >
                        <UITable style={{ width: 'auto', height: '100%' }}>
                          <TableHeader>
                            <TableRow className="border-b-white/20">
                              <TableHead className="text-white" style={{
                                minWidth: '70px', // reduced from 100px
                                padding: '4px',
                                fontSize: '11px',
                                whiteSpace: 'nowrap',
                              }}>Player</TableHead>
                              <TableHead className="text-white" style={{
                                minWidth: '60px', // reduced from 80px
                                padding: '4px',
                                textAlign: 'center',
                                fontSize: '11px',
                                whiteSpace: 'nowrap',
                              }}>Total Buy-ins</TableHead>
                              <TableHead className="text-white" style={{
                                minWidth: '90px', // reduced from 140px
                                padding: '4px',
                                textAlign: 'center',
                                fontSize: '11px'
                              }}>End Up</TableHead>
                              {/* NEW COLUMN */}
                              <TableHead className="text-white" style={{
                                minWidth: '120px',
                                padding: '4px',
                                textAlign: 'center',
                                fontSize: '11px'
                              }}>Total Profit / 7</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Array.isArray(players) && players.map((p: any) => {
                              const totalBuyIns = parseInt(String(playerTotals[p.id] ?? 0), 10);
                              const endUp = endUpValues[p.id] ?? 0;
                              const profitDiv7 = ((endUp - totalBuyIns) / 7).toFixed(2);
                              return (
                                <TableRow
                                  key={p.id}
                                  className="border-b-white/10"
                                  style={{ minHeight: 28 }}
                                >
                                  <TableCell style={{
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    height: 28,
                                    verticalAlign: 'middle',
                                    minWidth: '70px', // reduced from 100px
                                  }}>{p.name}</TableCell>
                                  <TableCell style={{
                                    padding: '4px 8px',
                                    textAlign: 'center',
                                    fontSize: '12px',
                                    height: 28,
                                    verticalAlign: 'middle',
                                    minWidth: '60px' // reduced from 80px
                                  }}>
                                    {totalBuyIns}
                                  </TableCell>
                                  <TableCell style={{
                                    padding: '4px 8px',
                                    textAlign: 'center',
                                    fontSize: '12px',
                                    height: 28,
                                    verticalAlign: 'middle',
                                    minWidth: '90px' // reduced from 140px
                                  }}>
                                    <Input
                                      type="number"
                                      step="any" // allow decimal input
                                      disabled={!isAdmin} // read-only for regular players
                                      className="bg-white/10 border-white/30 text-white placeholder-gray-400 focus:ring-white/50"
                                      style={{
                                        width: 90,
                                        height: 28,
                                        fontSize: '12px',
                                        padding: '4px 6px',
                                        textAlign: 'center',
                                        lineHeight: '24px'
                                      }}
                                      value={endUp}
                                      onChange={e => handleEndUpChange(p.id, parseFloat(e.target.value || '0'))}
                                    />
                                  </TableCell>
                                  {/* NEW COLUMN */}
                                  <TableCell style={{
                                    padding: '4px 8px',
                                    textAlign: 'center',
                                    fontSize: '12px',
                                    height: 28,
                                    verticalAlign: 'middle'
                                  }}>
                                    {profitDiv7}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                            {/* Totals row */}
                            <TableRow className="font-bold border-t border-t-white/20 bg-white/5" style={{ minHeight: 28 }}>
                              <TableCell style={{ fontSize: '12px', padding: '4px 8px', height: 28, verticalAlign: 'middle', minWidth: '70px' }}>Total</TableCell>
                              <TableCell style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                padding: '4px 8px',
                                height: 28,
                                verticalAlign: 'middle',
                                minWidth: '60px'
                              }}>
                                {Object.values(playerTotals).reduce((sum, v) => sum + parseInt(String(v), 10), 0)}
                              </TableCell>
                              <TableCell style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                padding: '4px 8px',
                                height: 28,
                                verticalAlign: 'middle'
                              }}>
                                {Object.values(endUpValues).reduce((sum, v) => sum + parseFloat(String(v)), 0)}
                              </TableCell>
                              <TableCell style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                padding: '4px 8px',
                                height: 28,
                                verticalAlign: 'middle'
                              }}>
                                {
                                  players.length > 0
                                    ? players.reduce((sum: number, p: any) => {
                                        const totalBuyIns = parseInt(String(playerTotals[p.id] ?? 0), 10);
                                        const endUp = endUpValues[p.id] ?? 0;
                                                                               return sum + (endUp - totalBuyIns) / 7;
                                      }, 0).toFixed(2)
                                    : '0.00'
                                }
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </UITable>
                      </div>
                      <DialogFooter>
                        <Button variant="secondary" onClick={() => setOpenEndUp(false)}>Close</Button>
                        {/* Admin-only Save button persists via broadcast so everyone receives values */}
                        {isAdmin && (
                          <Button onClick={handleSaveEndUp} className="ml-2">
                            Save End Up
                          </Button>
                        )}
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
                {/* Edit Profile button - placed immediately after End Up button */}
                <Button
                  variant="outline"
                  className="px-2 py-1 min-w-[70px] text-[13px] rounded shadow-sm bg-gray-700 hover:bg-gray-800 text-white border-none flex items-center gap-1 transition-all"
                  onClick={() => {
                    setEditName(profile?.name || '');
                    setEditError('');
                    setOpenEditProfile(true);
                  }}
                >
                  <span role="img" aria-label="edit">✏️</span>
                  Edit Profile
                </Button>
              </div>
              {/* Admin notification and approval UI */}
              {isAdmin && pendingRequests.length > 0 && (
                <Card className="mb-6 bg-gray-900/80 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white">Pending Buy-in Requests</CardTitle>
                    <CardDescription className="text-gray-400">Approve or reject buy-in requests below.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {pendingRequests.map((r) => (
                        <div key={r.id} className="flex items-center justify-between rounded-md border p-3 border-gray-700">
                          <div>
                            <div className="font-medium text-white">
                              {players.find((p: any) => p.id === r.player_id)?.name || r.player_id}
                            </div>
                            <div className="text-sm text-yellow-400">
                              {`${r.amount >= 0 ? '+' : ''}$${r.amount.toFixed(2)}`}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(r.id)}
                              disabled={processingRequests.includes(r.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => handleReject(r.id)}
                              disabled={processingRequests.includes(r.id)}
                            >
                              Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* Admin notification and approval UI for join requests */}
              {isAdmin && pendingJoinRequests.length > 0 && (
                <Card className="mb-6 bg-gray-900/80 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white">Pending Join Requests</CardTitle>
                    <CardDescription className="text-gray-400">Approve or reject player join requests below.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {pendingJoinRequests.map((r) => {
                        // Show only player name, hide player ID
                        const playerObj = players.find((p: any) => p.id === r.player_id);
                        const displayName = playerObj?.name || r.player_name || '';
                        return (
                          <div key={r.id} className="flex items-center justify-between rounded-md border p-3 border-gray-700">
                            <div>
                              <div className="font-medium text-white">
                                {displayName}
                              </div>
                              <div className="text-sm text-gray-300">
                                Join request
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button 
                                size="sm" 
                                onClick={() => handleApproveJoin(r.id)}
                                disabled={processingJoinRequests.includes(r.id)}
                              >
                                Approve
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive" 
                                className="bg-red-600 hover:bg-red-700 text-white"
                                onClick={() => handleRejectJoin(r.id)}
                                disabled={processingJoinRequests.includes(r.id)}
                              >
                                Reject
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* Player totals table */}
              <Card className="mb-6 bg-gray-900/50 border-gray-700">
                <CardHeader className="p-4">
                  <CardTitle className="text-white">Total Buy-ins</CardTitle>
                  <CardDescription className="text-gray-400">
                    Your total approved buy-ins for this table.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {/* Show only the current user's total buy-ins */}
                  <div className="flex flex-col items-center justify-center py-2">
                    <div className="text-4xl font-bold text-white">
                      {parseInt(String(playerTotals[profile?.id] ?? 0), 10)}
                    </div>
                    <div className="text-gray-200 mt-2">
                      Player: {profile?.name}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <div className="mt-4" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <UITable>
              <TableHeader>
                <TableRow className="border-b-green-400/30">
                  <TableHead className="text-white">Player</TableHead>
                  <TableHead className="text-right text-white">Total Buy-ins</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Always show all players, regardless of active status.
                  - Dim only real 'inactive' players (status === 'inactive').
                  - Show '(Pending)' for players waiting admin approval (do not show red 'Exited'). */}
                {players.map((p: any) => {
                  const isPending = !!p.pending;
                  const isInactive = !p.pending && p.active === false; // only treat as exited when not pending
                  return (
                    <TableRow key={p.id} className={`border-b-green-400/20 ${isInactive ? 'opacity-50' : ''}`}>
                      <TableCell className="font-medium text-white">
                        {p.name}
                        {isPending && (
                          <span style={{ color: '#fcd34d', marginLeft: 6, fontSize: 12 }}>(Pending)</span>
                        )}
                                               {isInactive && (
                          <span style={{ color: '#ef4444', marginLeft: 6, fontSize: 12 }}>(Exited)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-white">
                        {parseInt(String(p.totalPoints ?? 0), 10)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </UITable>
          </div>

          {/* Exit Game button (always visible) */}
         
          <Dialog open={openExit} onOpenChange={setOpenExit}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="px-2 py-1 min-w-[70px] text-[13px] rounded shadow-sm bg-red-600 hover:bg-red-700 text-white border-none flex items-center gap-1 transition-all"
                disabled={processingExit}
              >
                <span role="img" aria-label="exit">🚪</span>
                Back to Table Selection
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-900/90 backdrop-blur-md border-white/20 text-white">
              <DialogHeader>
                <DialogTitle>Exit Game</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p>You will be moved to the table selection page.</p>
                <p className="text-gray-300 text-sm">Click Yes to continue.</p>
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => setOpenExit(false)}
                  disabled={processingExit}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    setOpenExit(false);
                    await handleExitGame();
                  }}
                  disabled={processingExit}
                >
                  Yes, Exit Table
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Edit Profile dialog (always rendered, controlled by openEditProfile state) */}
      <Dialog open={openEditProfile} onOpenChange={setOpenEditProfile}>
        <DialogContent className="bg-gray-900/90 backdrop-blur-md border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="editName">New Name</Label>
            <Input
              id="editName"
              value={editName}
              onChange={handleEditNameChange}
              className="bg-white/10 border-white/30 text-white placeholder-gray-400 focus:ring-white/50"
              maxLength={30}
              autoFocus
            />
            {editError && (
              <div className="text-red-500 text-sm mt-2">{editError}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!editName.trim()) {
                  setEditError('Please enter your name.');
                  return;
                }
                setEditSubmitting(true);
                try {
                  // Check for existing name (case-insensitive, excluding current user)
                  const { data: existingPlayers, error } = await supabase
                    .from('players')
                    .select('id,name')
                    .ilike('name', editName.trim());

                  if (error) {
                    setEditError('Error checking name. Please try again.');
                    setEditSubmitting(false);
                    return;
                  }

                  // Exclude current user's own name from the check
                  const nameTaken = (existingPlayers || []).some(
                    (p: any) => p.name?.toLowerCase() === editName.trim().toLowerCase() && p.id !== profile?.id
                  );

                  if (nameTaken) {
                    setEditError('This name already exists. Please provide a new name.');
                    setEditName('');
                    setEditSubmitting(false);
                    return;
                  }

                  await supabase
                    .from('players')
                    .update({ name: editName.trim() })
                    .eq('id', profile?.id);

                  storage.setProfile({ ...profile, name: editName.trim() });

                  // If current user is admin, update adminName state immediately
                  if (profile?.id === normalizedAdminId) {
                    setAdminName(editName.trim());
                  }

                  setEditSubmitting(false);
                  setOpenEditProfile(false);
                  toast.success('Profile updated!');

                  // Broadcast refresh event so all pages update player names
                  await supabase
                    .channel('table_' + table.id)
                    .send({
                      type: 'broadcast',
                      event: 'join_refresh',
                      payload: { updatedPlayer: profile?.id }
                    });

                  // Local refresh
                  await refreshTableData(table.id, 'edit profile');
                } catch (error) {
                  setEditError('Failed to update profile. Please try again.');
                  setEditSubmitting(false);
                }
              }}
              disabled={editSubmitting || !editName.trim()}
            >
              {editSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PokerTable;

/*
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
*/