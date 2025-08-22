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
}

const PokerTable = ({ table, profile, refreshKey }: PokerTableProps) => {
  // NORMALIZE admin id & join code (covers snake_case / camelCase)
  const normalizedAdminId = table.adminId || (table as any).admin_player_id;
  const normalizedJoinCode = table.joinCode ?? (table as any).join_code;
  const isAdmin = !!profile && !!normalizedAdminId && profile.id === normalizedAdminId;

  // DEBUG (remove later if desired)
  if (typeof window !== 'undefined') {
    console.log('[PokerTable][AdminCheck]', {
      profileId: profile?.id,
      normalizedAdminId,
      adminName: table.adminName,
      isAdmin,
      rawKeys: Object.keys(table || {})
    });
  }

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
  const [pendingJoinRequests, setPendingJoinRequests] = useState<any[]>([]);
  const [historyData, setHistoryData] = useState<any[]>([]); // Store buy-in history
  const [endUpValues, setEndUpValues] = useState<Record<string, number>>({}); // Store end up values per player
  const [processingRequests, setProcessingRequests] = useState<string[]>([]);
  const [processingJoinRequests, setProcessingJoinRequests] = useState<string[]>([]);
  const [processingExit, setProcessingExit] = useState(false);
  const [adminName, setAdminName] = useState<string>('');

// NEW: fetch admin name (used by refreshTableData + fallback effect)
  const fetchAdminName = async (tableId: string) => {
    try {
      const { data: tbl } = await supabase
        .from('poker_tables')
        .select('admin_player_id')
        .eq('id', tableId)
        .maybeSingle();
      const adminId = tbl?.admin_player_id;
      if (!adminId) {
        setAdminName('N/A');
        return;
      }
      const { data: player } = await supabase
        .from('players')
        .select('name')
        .eq('id', adminId)
        .maybeSingle();
      setAdminName(player?.name || 'N/A');
    } catch {
      setAdminName(prev => prev || 'Loading...');
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
      setPendingJoinRequests(mapped);
      setPendingJoinPlayerIds(new Set(mapped.map(r => r.player_id)));
    } catch (e) {
      console.warn('[PokerTable] fetchPendingJoinRequests failed (ignored):', e);
      setPendingJoinRequests([]);
      setPendingJoinPlayerIds(new Set());
    }
  };

// MODIFIED: refresh includes admin name first
  const refreshTableData = async (tableId: string, source: string) => {
    if (!tableId) return;
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[PokerTable] refreshTableData', { source, tableId });
    }
    await fetchAdminName(tableId);                 // ADDED
    await fetchPendingJoinRequests(tableId);
    const totals = await fetchTotals(tableId);
    await loadPlayersFromJoinTable(tableId, totals || {});
    await fetchBuyInHistory(tableId);
    await ensureCurrentPlayerActive(tableId);
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

  // Add new state to hold players loaded from table_players + players table
  const [players, setPlayers] = useState<TablePlayer[]>(table?.players || []);

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
  const fetchTotals = async (tableId?: string): Promise<Record<string, number> | null> => { // CHANGED (added explicit return type)
    const id = tableId || table?.id;
    if (!id) return null; // CHANGED (return null on early exit)
    try {
      const { data, error } = await supabase
        .from('buy_ins')
        .select('player_id, amount')
        .eq('table_id', id) as any;
      if (!error && data) {
        const totals: Record<string, number> = {};
        (data as Array<{ player_id: string; amount: number }>).forEach((row) => {
          totals[row.player_id] = (totals[row.player_id] || 0) + Number(row.amount);
        });
        setPlayerTotals(totals);

        // Dev-only: log when totals change so regular users see the update in logs,
        // include each player's name and status (active/pending/inactive) where available.
        if (process.env.NODE_ENV !== 'production') {
          try {
            const nameById: Record<string, string> = {};
            (players || []).forEach(p => { if (p?.id) nameById[p.id] = p.name; });
            const ids = Array.from(new Set([ ...Object.keys(totals), ...(players || []).map(p => p.id) ]));
            const snapshot = ids.map(pid => {
              const p = (players || []).find(x => x.id === pid);
              const status = p ? (p.pending ? 'pending' : (p.active ? 'active' : 'inactive')) : 'unknown';
              return {
                id: pid,
                name: nameById[pid] || null,
                status,
                total: totals[pid] ?? 0
              };
            });
            const keys = Object.keys(totals);
            const sum = keys.reduce((s, k) => s + (Number(totals[k]) || 0), 0);
            console.debug('[PokerTable] fetchTotals updated:', { tableId: id, players: snapshot, playersCount: keys.length, totalSum: sum });
          } catch (e) {
            console.debug('[PokerTable] fetchTotals debug build failed (ignored):', e);
          }
        }

        // also merge totals into already-loaded players to keep UI consistent
        setPlayers(prev => prev.map(p => ({ ...p, totalPoints: totals[p.id] ?? 0 })));
        return totals; // CHANGED (return freshly computed totals)
      }
    } catch (e) {
      console.warn('[PokerTable] fetchTotals error (ignored):', e);
    }
    return null; // CHANGED (ensure null return on failure)
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
      if (!error && data) setHistoryData(data);
    } catch (e) {
      console.warn('[PokerTable] fetchBuyInHistory failed (ignored):', e);
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
        async () => {
          try {
            await refreshTableData(table.id, 'buy_ins change');
          } catch (e) {
            console.warn('[PokerTable] buy_ins realtime handler failed (ignored):', e);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table?.id]);

  // Subscribe to broadcasts targeted at the current user for buy-in approval notifications
  useEffect(() => {
    if (!profile?.id || !table?.id) return;
    const chan = supabase
      .channel('user_' + profile.id)
      .on('broadcast', { event: 'buy_in_approved' }, async (payload) => {
        try {
          const approvedTableId = payload?.payload?.tableId;
            if (!approvedTableId || approvedTableId !== table.id) return;
          await refreshTableData(table.id, 'buy_in_approved broadcast');
          toast('Your buy-in was approved', { description: `Amount: ${payload?.payload?.amount ?? ''}` });
        } catch (e) {
          console.error('[PokerTable] user-channel buy_in_approved handler error:', e);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  }, [profile?.id, table?.id]);

  // REMOVED: join_approved listener (now should live in parent Index.tsx to handle navigation when PokerTable is not yet mounted)
  // useEffect(() => {
  //   if (!profile?.id || !table?.id) return;
  //   const chan = supabase
  //     .channel('user_' + profile.id)
  //     .on('broadcast', { event: 'join_approved' }, async (payload) => {
  //       try {
  //         const approvedTableId = payload?.payload?.tableId;
  //         if (!approvedTableId || approvedTableId !== table.id) return;
  //         toast('Your join request was approved!');
  //         await refreshTableData(table.id, 'join_approved broadcast');
  //       } catch (e) {
  //         console.error('[PokerTable] user-channel join_approved handler error:', e);
  //       }
  //     })
  //     .subscribe();
  //   return () => { supabase.removeChannel(chan); };
  // }, [profile?.id, table?.id]);

  // Handler for exiting the game
  const handleExitGame = async () => {
    if (!table || !profile) return;
    setProcessingExit(true);

    // Fire-and-forget: perform DB updates in background so UI is not blocked by network latency/errors.
    (async () => {
      try {
        // Mark current user inactive — use safe helper to avoid sending on_conflict in normal path
        try {
          await safeUpsertTablePlayer(table.id, profile.id, 'inactive');
        } catch (e) {
          console.warn('[PokerTable][background] marking inactive failed (ignored):', e);
        }

        // If admin, try to clear admin_player_id (best-effort)
        if (isAdmin) {
          try {
            await supabase
              .from('poker_tables')
              .update({ admin_player_id: null })
              .eq('id', table.id);
          } catch (err) {
            console.warn('[PokerTable][background] clearing admin_player_id failed (ignored):', err);
          }
        }

        // Best-effort reconciliation in background
        try { await loadPlayersFromJoinTable(table.id, playerTotals); } catch (err) { console.warn('[PokerTable][background] reload players failed (ignored):', err); } // CHANGED (pass playerTotals)
        try { await fetchTotals(table.id); } catch (err) { /* ignore */ }
      } catch (e) {
        console.error('[PokerTable][background] reconciliation unexpected error (ignored):', e);
      }
    })();

    // Immediately clear persisted table & navigate away so user sees selection quickly.
    try { storage.setTable(null); } catch (e) { console.warn('[PokerTable] storage.setTable failed:', e); }
    // local cleanup (component will unload after navigation)
    setProcessingExit(false);
    setOpenExit(false);
    // Force navigation now (do not await background tasks)
    window.location.replace('/');
  };

  // Handler to request a buy-in from a player (used by the Buy-in dialog)
  const handleRequestBuyIn = async () => {
	// guard
	if (!table || !profile) return;

	const buyInReq = {
		id: uuidv4(),
		table_id: table.id,
		player_id: profile.id,
		amount: parseFloat(amount || '0'),
		status: 'pending',
		created_at: new Date().toISOString()
	};

	// insert request
	try {
		const { error } = await supabase.from('buy_in_requests').insert(buyInReq);
		if (error) {
			console.error('[PokerTable] Failed to insert buy_in_request:', error);
			alert('Failed to request buy-in.');
			return;
		}
	} catch (e) {
		console.error('[PokerTable] Exception inserting buy_in_request (ignored):', e);
		alert('Failed to request buy-in.');
		return;
	}

	// best-effort broadcast to admin so they get a fast notification (non-fatal)
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
		// ignore broadcast failures (realtime DB channel still works)
		console.warn('[PokerTable] buy_in_request broadcast failed (ignored):', e);
	}

	// If the requester is the admin, they may not receive their own broadcast.
	// Refresh local pendingRequests and show a toast so admin sees the notification immediately.
	if (isAdmin) {
		try {
			const { data: reqs, error: fetchErr } = await supabase
				.from('buy_in_requests')
				.select('*')
				.eq('table_id', table.id)
				.eq('status', 'pending');
			if (!fetchErr) {
				setPendingRequests(reqs || []);
			}
		} catch (e) {
			console.warn('[PokerTable] failed to refresh pending buy_in_requests for admin (ignored):', e);
		}
		toast('New buy-in request', { description: `${profile?.name || 'You'} requested a buy-in` });
	}

	// close dialog and reset input
	setOpenBuyIn(false);
	setAmount('');
	setPendingRequests(prev => prev); // keep UI stable; realtime will update pendingRequests
};

// Handler for requesting to join a table (regular players)
const handleRequestJoin = async () => {
	if (!table || !profile) return;
	const playerId = profile.id;
	try {
		// Check if the player already has a table_players row (was ever part of the table)
		const { data: tpRow } = await supabase
			.from('table_players')
			.select('id,status')
			.eq('table_id', table.id)
			.eq('player_id', playerId)
			.maybeSingle();

		if (tpRow) {
			// If already in table_players, just activate (no approval needed)
			await safeUpsertTablePlayer(table.id, playerId, 'active');
			// Immediately update totals and player list for all players
			await fetchTotals(table.id);
			await loadPlayersFromJoinTable(table.id, playerTotals);
			toast('You have rejoined the table.');
			return;
		}

		// If there's already a pending join_request, update local pending state and exit.
		const { data: existingReq } = await supabase
			.from('join_requests')
			.select('id,player_id,table_id,status,created_at')
			.eq('table_id', table.id)
			.eq('player_id', playerId)
			.maybeSingle();
		if (existingReq && existingReq.id) {
			setPendingJoinPlayerIds(prev => {
				const next = new Set(prev);
				next.add(playerId);
				return next;
			});
			setPendingJoinRequests(prev => {
				if (prev.some(r => r.id === existingReq.id)) return prev;
				return [...prev, { ...existingReq, player_name: profile.name }];
			});
			toast('Join request already pending');
			return;
		}

		// Not in table_players: create join_request and notify admin
		const reqId = uuidv4();
		const newReq = {
			id: reqId,
			table_id: table.id,
			player_id: playerId,
			status: 'pending',
			created_at: new Date().toISOString()
		};
		const { error: insertErr } = await supabase.from('join_requests').insert(newReq);
		if (insertErr) {
			console.error('[PokerTable] insert join_request failed:', insertErr);
			toast('Failed to create join request');
			return;
		}

		// Best-effort: notify admin so they get a quick UI prompt (non-fatal)
		try {
			const adminId = table?.admin_player_id;
			if (adminId) {
				await supabase
					.channel('user_' + adminId)
					.send({
						type: 'broadcast',
						event: 'join_request_created',
						payload: { requestId: reqId, playerName: profile?.name, tableId: table.id }
					});
			}
		} catch (e) {
			console.warn('[PokerTable] join_request broadcast to admin failed (ignored):', e);
		}

		// Update local pending markers so UI shows the pending state immediately
		setPendingJoinPlayerIds(prev => {
			const next = new Set(prev);
			next.add(playerId);
			return next;
		});
		setPendingJoinRequests(prev => [...prev, { ...newReq, player_name: profile.name }]);
		toast('Join request sent');
	} catch (e) {
		console.error('[PokerTable] handleRequestJoin error:', e);
		toast('Failed to send join request');
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
const retryQuery = async <T>(fn: () => Promise<T>, retries = 3, baseDelay = 150): Promise<T> => {
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
  if (!tableId) return;
  try {
    // retry the table_players lookup when transient/access-control errors occur
    const joinRes = await retryQuery(() =>
      supabase
        .from('table_players')
        .select('player_id,status')
        .eq('table_id', tableId)
    );
    const { data: joinRows, error: joinErr } = joinRes as any;
    if (joinErr) {
      console.warn('[PokerTable] loadPlayersFromJoinTable: table_players lookup failed (ignored):', joinErr);
      return;
    }
    const ids = Array.from(new Set((joinRows || []).map((r: any) => r.player_id).filter(Boolean)));
    if (ids.length === 0) {
      setPlayers([]);
      return;
    }

    // retry players lookup too
    const playersRes = await retryQuery(() =>
      supabase
        .from('players')
        .select('id,name')
        .in('id', ids)
    );
    const { data: playersData, error: playersErr } = playersRes as any;
    if (playersErr) {
      console.warn('[PokerTable] loadPlayersFromJoinTable: players lookup failed (ignored):', playersErr);
      return;
    }
    const statusById: Record<string, string | undefined> = {};
    (joinRows || []).forEach((r: any) => { if (r.player_id) statusById[r.player_id] = r.status; });
    const nextPlayers: TablePlayer[] = (playersData || []).map((p: any) => {
      const status = statusById[p.id];
      const hasPending = pendingJoinPlayerIds.has(p.id);
      const isActiveByDb = status === 'active' || (status === undefined && !hasPending);
      return {
        id: p.id,
        name: p.name,
        totalPoints: totals[p.id] ?? 0,
        active: !!isActiveByDb,
        pending: !isActiveByDb && hasPending
      };
    });
    setPlayers(nextPlayers);
  } catch (e) {
    console.error('[PokerTable] loadPlayersFromJoinTable unexpected error (ignored):', e);
  }
};

// Admin handlers for buy-in requests
const handleApprove = async (reqId: string) => {
  if (!reqId || processingRequests.includes(reqId) || !table) return;
  setProcessingRequests(prev => [...prev, reqId]);
  try {
    const { data: reqRow } = await supabase
      .from('buy_in_requests')
      .select('*')
      .eq('id', reqId)
      .maybeSingle();
    const req = (reqRow as any) || null;
    if (!req) throw new Error('buy_in_request not found');

    await supabase.from('buy_ins').insert({
      id: uuidv4(),
      table_id: table.id,
      player_id: req.player_id,
      amount: req.amount,
      timestamp: new Date().toISOString()
    });

    await supabase.from('buy_in_requests').delete().eq('id', reqId);

    // Central refresh (ensures totals + history + players + admin)
    await refreshTableData(table.id, 'handleApprove');

    // reload pending (best-effort)
    try {
      const { data } = await supabase
        .from('buy_in_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      setPendingRequests(data || []);
    } catch { /* ignore */ }

    // notify requesting player
    try {
      await supabase
        .channel('user_' + req.player_id)
        .send({
          type: 'broadcast',
            event: 'buy_in_approved',
            payload: { tableId: table.id, amount: req.amount }
        });
    } catch { /* ignore */ }

    // NEW: broadcast to all table participants
    try {
      await supabase
        .channel('table_' + table.id)
        .send({
          type: 'broadcast',
          event: 'buy_in_updated',
          payload: { by: profile?.id, amount: req.amount }
        });
    } catch (e) {
      console.warn('[PokerTable] table-wide buy_in_updated broadcast failed (ignored):', e);
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

return (
    <div className="min-h-screen bg-gradient-page flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl shadow-elegant">
        <CardHeader>
          <CardTitle>
            Poker Table: {table.name || normalizedJoinCode}
          </CardTitle>
          <CardDescription>
            Join Code: {normalizedJoinCode} <br />
            Admin: {adminName || 'Loading...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Buy-in request section */}
          <div className="mb-6 flex gap-2 items-center flex-wrap">
            {/* Buy-in request button (always visible) */}
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
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request Buy-in</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount (can be positive or negative)</Label>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button onClick={handleRequestBuyIn}>Submit</Button>
                </DialogFooter>
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
              <HistoryDialogContent style={{ minWidth: 350, maxWidth: 600 }}>
                <HistoryDialogHeader>
                  <HistoryDialogTitle>Buy-in History</HistoryDialogTitle>
                </HistoryDialogHeader>
                <div style={{
                  fontSize: '11px',
                  overflowX: 'auto',
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

            {/* End Up button (only visible for admin, comes after history) */}
            {isAdmin && (
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
                <DialogContent style={{
                  minWidth: 320,
                  maxWidth: '100vw',
                  padding: '8px',
                  overflowX: 'auto'
                }}>
                  <DialogHeader>
                    <DialogTitle>End Up Game</DialogTitle>
                  </DialogHeader>
                  <div style={{
                    fontSize: '10px',
                    maxHeight: '60vh',
                    overflowX: 'auto',
                    padding: '0'
                  }}>
                    <UITable>
                      <TableHeader>
                        <TableRow>
                          <TableHead style={{
                            minWidth: 50,
                            padding: '2px 2px',
                            fontSize: '10px'
                          }}>Player</TableHead>
                          <TableHead style={{
                            minWidth: 40,
                            padding: '2px 2px',
                            textAlign: 'center',
                            fontSize: '10px'
                          }}>Total Buy-ins</TableHead>
                          <TableHead style={{
                            minWidth: 40,
                            padding: '2px 2px',
                            textAlign: 'center',
                            fontSize: '10px'
                          }}>End Up</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.isArray(players) && players.map((p: any) => (
                          <TableRow key={p.id}>
                            <TableCell style={{
                              minWidth: 50,
                              padding: '2px 2px',
                              fontSize: '10px'
                            }}>{p.name}</TableCell>
                            <TableCell style={{
                              minWidth: 40,
                              padding: '2px 2px',
                              textAlign: 'center',
                              fontSize: '10px'
                            }}>
                              {parseInt(String(playerTotals[p.id] ?? 0), 10)}
                            </TableCell>
                            <TableCell style={{
                              minWidth: 40,
                              padding: '2px 2px',
                              textAlign: 'center',
                              fontSize: '10px'
                            }}>
                              <Input
                                type="number"
                                style={{
                                  width: 40,
                                  fontSize: '10px',
                                  padding: '2px 2px',
                                  textAlign: 'center'
                                }}
                                value={endUpValues[p.id] ?? ''}
                                onChange={e => handleEndUpChange(p.id, parseInt(e.target.value || '0', 10))}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals row */}
                        <TableRow className="font-bold border-t">
                          <TableCell style={{ fontSize: '10px' }}>Total</TableCell>
                          <TableCell style={{
                            textAlign: 'center',
                            fontSize: '10px'
                          }}>
                            {Object.values(playerTotals).reduce((sum, v) => sum + parseInt(String(v), 10), 0)}
                          </TableCell>
                          <TableCell style={{
                            textAlign: 'center',
                            fontSize: '10px'
                          }}>
                            {Object.values(endUpValues).reduce((sum, v) => sum + parseInt(String(v), 10), 0)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </UITable>
                  </div>
                  <DialogFooter>
                    <Button variant="secondary" onClick={() => setOpenEndUp(false)}>Close</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          {/* Admin notification and approval UI */}
          {isAdmin && pendingRequests.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Pending Buy-in Requests</CardTitle>
                <CardDescription>Approve or reject buy-in requests below.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendingRequests.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <div className="font-medium">
                          {players.find((p: any) => p.id === r.player_id)?.name || r.player_id}
                        </div>
                        <div className="text-sm text-muted-foreground">
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
                          variant="outline"
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
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Pending Join Requests</CardTitle>
                <CardDescription>Approve or reject player join requests below.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendingJoinRequests.map((r) => {
                    // Show only player name, hide player ID
                    const playerObj = players.find((p: any) => p.id === r.player_id);
                    const displayName = playerObj?.name || r.player_name || '';
                    return (
                      <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                          <div className="font-medium">
                            {displayName}
                          </div>
                          <div className="text-sm text-muted-foreground">
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
                            variant="outline" 
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
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Total Buy-ins</CardTitle>
              <CardDescription>
                Your total approved buy-ins for this table.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Show only the current user's total buy-ins */}
              <div className="flex flex-col items-center justify-center py-4">
                <div className="text-xl font-bold">
                  ${playerTotals[profile?.id]?.toFixed(2) || '0.00'}
                </div>
                <div className="text-muted-foreground mt-2">
                  Player: {profile?.name}
                </div>
              </div>
            </CardContent>
          </Card>

          <UITable>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Total Buy-ins</TableHead>
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
                  <TableRow key={p.id} className={isInactive ? 'opacity-50' : ''}>
                    <TableCell>
                      {p.name}
                      {isPending && (
                        <span style={{ color: '#666', marginLeft: 6, fontSize: 12 }}>(Pending)</span>
                      )}
                      {isInactive && (
                        <span style={{ color: 'red', marginLeft: 6, fontSize: 12 }}>(Exited)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {parseInt(String(p.totalPoints ?? 0), 10)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </UITable>

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
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Exit Game</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p>You will be moved to the table selection page.</p>
                <p className="text-muted-foreground text-sm">Click Yes to continue.</p>
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
// SUMMARY: Removed local tableState + syncing useEffect (infinite re-render source). Use prop table directly in render.