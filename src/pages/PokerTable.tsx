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
import { Player, PokerTable as PokerTableType, Game, GameProfit } from '@/integrations/supabase/types';
import { TablePlayerLocal, EnhancedPokerTable } from '@/types/table';
import { Banknote, ScrollText, Flag, Pencil, LogOut, Copy, Play, BarChart3 } from 'lucide-react';

type PokerTableRow = {
  admin_player_id?: string; // changed from admin_user_id
  created_at?: string;
  id?: string;
  join_code?: string;
  name?: string;
  status?: "active" | "ended";
  updated_at?: string;
  players: TablePlayerLocal[];
};

interface PokerTableProps {
  table: EnhancedPokerTable;
  profile?: Player | null;
  refreshKey?: number;
  onExit: () => void;
  showBackground?: boolean; // NEW: optional background toggle
}

const PokerTable = ({ table, profile, refreshKey, onExit, showBackground = true }: PokerTableProps) => {
  // NORMALIZE admin id & join code (covers snake_case / camelCase)
  const normalizedAdminId = table.adminId || table.admin_player_id;
  const normalizedJoinCode = table.joinCode ?? (table as any).join_code;
  const isAdmin = !!profile && !!normalizedAdminId && profile.id === normalizedAdminId;

  // Add new state to hold players loaded from table_players + players table
  const [players, setPlayers] = useState<TablePlayerLocal[]>(table?.players || []);

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
  const [openSummary, setOpenSummary] = useState(false); // Add state for summary dialog
  const [openStartNewGame, setOpenStartNewGame] = useState(false); // Add state for start new game dialog
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
  const [copied, setCopied] = useState(false);
  const [currentGame, setCurrentGame] = useState<Game | null>(null);
  const [gameProfits, setGameProfits] = useState<GameProfit[]>([]);
  const [summaryData, setSummaryData] = useState<{
    playerName: string;
    totalProfit: number;
    gameProfits: { gameNumber: number; profit: number }[];
  }[]>([]);

  const handleCopyJoinCode = () => {
    if (!normalizedJoinCode) return;
    navigator.clipboard.writeText(normalizedJoinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
    // NEW: fetch current game
    await fetchCurrentGame(tableId);
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

  // Fetch current game when table changes
  useEffect(() => {
    if (table?.id) {
      fetchCurrentGame(table.id);
    }
  }, [table?.id]);

  // New helper: fetch totals for a table and update playerTotals + players
  const fetchTotals = async (tableId?: string): Promise<Record<string, number> | null> => {
    const id = tableId || table?.id;
    if (!id) return null;
    try {
      // CHANGED: use RPC (SECURITY DEFINER) instead of direct select (RLS mismatch).
      const { data, error } = await (supabase as any).rpc('get_table_totals', { p_table_id: id });
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
      if (Array.isArray(data)) {
        data.forEach((r: any, idx: number) => {
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
      }

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
          const res = await retryQuery(async () =>
            await supabase
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
        const res = await retryQuery(async () =>
          await supabase
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
      .on('broadcast', { event: 'new_game_started' }, async (payload) => {
        console.log('[PokerTable][broadcast][new_game_started] received', payload);
        try {
          await refreshTableData(table.id, 'broadcast:new_game_started');
          toast.info(`New game ${payload?.payload?.gameNumber || ''} started!`);
        } catch (e) {
          console.warn('[PokerTable] broadcast new_game_started refresh failed', e);
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
    const joinRes: any = await retryQuery(async () =>
      await supabase.from('table_players').select('player_id,status').eq('table_id', tableId)
    );
    const joinRows = joinRes.data || [];
    const ids = Array.from(new Set(joinRows.map((r: any) => r.player_id).filter(Boolean))) as string[];
    if (ids.length === 0) {
      setPlayers([]);
      console.log('[PokerTable][loadPlayersFromJoinTable] no players');
      return;
    }
    const playersRes: any = await retryQuery(async () => await supabase.from('players').select('id,name').in('id', ids));
    const playersData = playersRes.data || [];
    const statusById: Record<string, string> = {};
    joinRows.forEach((r: any) => { statusById[r.player_id] = r.status; });
    const nextPlayers: TablePlayerLocal[] = playersData.map((p: any) => ({
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
    const { data, error } = await (supabase as any).rpc('approve_buy_in', { p_request_id: reqId });
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
    // Try to fetch from end_ups table
    const { data, error } = await (supabase as any)
      .from('end_ups')
      .select('player_id, value')
      .eq('table_id', id);
    
    if (error) {
      // If table doesn't exist or other error, log and continue without end-up values
      console.warn('[PokerTable][fetchEndUpValues] end_ups not available or error:', error);
      return;
    }
    
    const map: Record<string, number> = {};
    (data || []).forEach((r: any) => {
      if (!r || !r.player_id) return;
      map[r.player_id] = Number(r.value || 0);
    });
    setEndUpValues(map);
    console.log('[PokerTable][fetchEndUpValues] loaded', { tableId: id, gameId: currentGame.id, count: Object.keys(map).length });
  } catch (e) {
    console.warn('[PokerTable][fetchEndUpValues] exception - table may not exist yet:', e);
    // Continue without end-up values if table doesn't exist
  }
};

// Helper function to calculate profit - SINGLE SOURCE OF TRUTH
// If you need to change the profit formula, only modify this function
const calculatePlayerProfit = (playerId: string, endUpValue: number, totalBuyIns: number) => {
  return (endUpValue - totalBuyIns) / 7;
};

// REPLACE: Admin action now persists to DB and broadcasts
const handleSaveEndUp = async () => {
  if (!table?.id || !currentGame?.id) return;
  try {
    // Prepare rows for upsert: one row per player with numeric value
    const rows = Object.keys(endUpValues).map(pid => ({
      table_id: table.id,
      player_id: pid,
      value: Number(endUpValues[pid] ?? 0),
      updated_at: new Date().toISOString()
    }));

    if (rows.length > 0) {
      // Try to upsert, but handle if table doesn't exist
      try {
        const { error } = await (supabase as any)
          .from('end_ups')
          .upsert(rows, { onConflict: 'table_id,player_id' });
        if (error) {
          console.warn('[PokerTable] handleSaveEndUp - end_ups may not exist:', error);
          toast.error('End-up values feature not available yet.');
          return;
        }
      } catch (e) {
        console.warn('[PokerTable] handleSaveEndUp - end_ups table not found:', e);
        toast.error('End-up values feature not available yet.');
        return;
      }
    } else {
      // If admin cleared all values locally, try to delete persisted rows for this table
      try {
        await (supabase as any).from('end_ups').delete().eq('table_id', table.id);
      } catch (e) { 
        console.warn('[PokerTable] handleSaveEndUp delete - table may not exist:', e);
        // ignore if table doesn't exist
      }
    }

    // Calculate and save profits for current game
    // IMPORTANT: Calculate profits for ALL players based on participation in current game
    // - Players who participated (have buy-ins OR end-up values): calculate actual profit
    // - Players who didn't participate (no buy-ins AND no end-up values): set profit to zero
    // This ensures correct summary totals regardless of player status (active/inactive)
    if (currentGame?.id) {
      try {
        // Get ALL players for this table (both active and inactive)
        const { data: tablePlayers, error: playersError } = await supabase
          .from('table_players')
          .select('player_id, status')
          .eq('table_id', table.id);
        
        if (playersError) {
          console.warn('[PokerTable] handleSaveEndUp - failed to get table players:', playersError);
        } else if (tablePlayers && tablePlayers.length > 0) {
          const activePlayers = tablePlayers.filter(tp => tp.status === 'active');
          const inactivePlayers = tablePlayers.filter(tp => tp.status === 'inactive');
          console.log('[PokerTable] handleSaveEndUp - calculating profits for all players:', {
            total: tablePlayers.length,
            active: activePlayers.length,
            inactive: inactivePlayers.length
          });
          
          // Calculate profits for ALL players (active and inactive)
          for (const tp of tablePlayers) {
            const playerId = tp.player_id;
            
            // Get total buy-ins for this player
            const { data: buyIns, error: buyInsError } = await supabase
              .from('buy_ins')
              .select('amount')
              .eq('table_id', table.id)
              .eq('player_id', playerId);
            
            if (buyInsError) {
              console.warn('[PokerTable] handleSaveEndUp - failed to get buy-ins for player:', playerId, buyInsError);
              continue;
            }
            
            // Calculate profit based on whether player participated in current game
            const totalBuyIns = buyIns?.reduce((sum, bi) => sum + Number(bi.amount), 0) || 0;
            const endUpValue = Number(endUpValues[playerId] || 0);
            
            let profit = 0;
            
            // If player has buy-ins OR end-up values, they participated in this game
            if (totalBuyIns > 0 || endUpValue > 0) {
              // Player participated: calculate actual profit
              profit = calculatePlayerProfit(playerId, endUpValue, totalBuyIns);
              
              console.log('[PokerTable] handleSaveEndUp - PARTICIPATED player profit calculation:', {
                playerId,
                status: tp.status,
                totalBuyIns,
                endUpValue,
                profit
              });
            } else {
              // Player didn't participate: set profit to zero
              profit = 0;
              
              console.log('[PokerTable] handleSaveEndUp - NON-PARTICIPATED player profit (zero):', {
                playerId,
                status: tp.status,
                totalBuyIns,
                endUpValue,
                profit
              });
            }
            
            // Save profit to game_profits table
            const { error: profitError } = await supabase
              .from('game_profits')
              .upsert({
                table_id: table.id,
                game_id: currentGame.id,
                player_id: playerId,
                profit: profit
              }, {
                onConflict: 'table_id,game_id,player_id'
              });
            
            if (profitError) {
              console.warn('[PokerTable] handleSaveEndUp - failed to save profit for player:', playerId, profitError);
            }
          }
        }
      } catch (e) {
        console.warn('[PokerTable] handleSaveEndUp - failed to calculate profits:', e);
      }
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
      
      // Also broadcast that profits were calculated
      await supabase
        .channel('table_' + table.id)
        .send({
          type: 'broadcast',
          event: 'profits_calculated',
          payload: { gameId: currentGame?.id }
        });
    } catch (e) {
      console.warn('[PokerTable] handleSaveEndUp broadcast failed (ignored)', e);
    }

    toast.success('End-up values saved! Profits calculated and available in Summary.');
  } catch (e) {
    console.error('[PokerTable] handleSaveEndUp failed', e);
    toast.error('Failed to save end-up values.');
  }
};

// NEW: Handle starting a new game
const handleStartNewGame = async () => {
  if (!table?.id || !isAdmin) return;
  
  try {
    // Mark current game as completed (profits already calculated when "Save End Up" was clicked)
    if (currentGame?.id) {
      await supabase
        .from('games')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', currentGame.id);
    }
    
    // Reset the table (clear buy-ins and end-ups)
    await (supabase as any).rpc('reset_table_for_new_game', { p_table_id: table.id });
    
    // Create a new game
    const { data: newGameId, error: gameError } = await (supabase as any).rpc('create_new_game', { p_table_id: table.id });
    
    if (gameError) {
      console.error('[PokerTable] Failed to create new game:', gameError);
      toast.error('Failed to start new game.');
      return;
    }
    
    // Fetch the new game details
    const { data: newGame, error: fetchError } = await supabase
      .from('games')
      .select('*')
      .eq('id', newGameId)
      .single();
    
    if (fetchError) {
      console.error('[PokerTable] Failed to fetch new game:', fetchError);
      toast.error('Failed to fetch new game details.');
      return;
    }
    
    setCurrentGame(newGame);
    setEndUpValues({});
    
    // Refresh table data
    await refreshTableData(table.id, 'start new game');
    
    // Broadcast to other clients
    await supabase
      .channel('table_' + table.id)
      .send({
        type: 'broadcast',
        event: 'new_game_started',
        payload: { gameId: newGameId, gameNumber: newGame.game_number }
      });
    
    toast.success(`Game ${newGame.game_number} started!`);
    setOpenStartNewGame(false);
  } catch (e) {
    console.error('[PokerTable] handleStartNewGame error:', e);
    toast.error('Failed to start new game.');
  }
};

// NEW: Fetch current game for the table
const fetchCurrentGame = async (tableId: string) => {
  try {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('table_id', tableId)
      .eq('status', 'active')
      .order('game_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.warn('[PokerTable] fetchCurrentGame error:', error);
      return;
    }
    
    setCurrentGame(data);
  } catch (e) {
    console.warn('[PokerTable] fetchCurrentGame exception:', e);
  }
};

// NEW: Fetch summary data (profits per player per game)
const fetchSummaryData = async (tableId: string) => {
  try {
    // 1. Fetch all profits data with game_number
    const { data: profits, error: profitsError } = await supabase
      .from('game_profits')
      .select('game_number, player_id, profit')
      .eq('table_id', tableId)
      .order('game_number', { ascending: true });

    if (profitsError) {
      console.warn('[PokerTable] fetchSummaryData profits error:', profitsError);
      setSummaryData([]);
      return;
    }

    // 2. Get unique game numbers and player IDs
    const gameNumbers = Array.from(new Set(profits?.map(p => p.game_number))).sort((a, b) => a - b);
    const playerIds = Array.from(new Set(profits?.map(p => p.player_id)));

    // 3. Fetch player names
    const { data: players } = await supabase
      .from('players')
      .select('id, name')
      .in('id', playerIds);

    const playerNames = new Map(players?.map(p => [p.id, p.name]) || []);

    // 4. Build summary data with proper game number handling
    const summaryMap = new Map<string, {
      playerName: string;
      totalProfit: number;
      gameResults: { [gameNumber: number]: number };
      gameNumbers: number[];
    }>();

    // Initialize data structure for all players
    playerIds.forEach(playerId => {
      summaryMap.set(playerId, {
        playerName: playerNames.get(playerId) || 'Unknown',
        totalProfit: 0,
        gameResults: {},
        gameNumbers: gameNumbers
      });
    });

    // Fill in profits where they exist
    profits?.forEach(profit => {
      const playerData = summaryMap.get(profit.player_id);
      if (playerData) {
        playerData.gameResults[profit.game_number] = profit.profit;
        playerData.totalProfit += profit.profit;
      }
    });

    // Convert to array and sort by total profit
    const summaryArray = Array.from(summaryMap.values())
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .map(player => ({
        ...player,
        // Ensure all game numbers have a value (0 or null for games not played)
        gameResults: gameNumbers.map(gameNum => 
          player.gameResults[gameNum] !== undefined ? player.gameResults[gameNum] : null
        )
      }));

    setSummaryData(summaryArray);

  } catch (e) {
    console.warn('[PokerTable] fetchSummaryData exception:', e);
    setSummaryData([]);
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
    .on('broadcast', { event: 'profits_calculated' }, (payload) => {
      try {
        console.log('[PokerTable][broadcast][profits_calculated] received', { tableId: table.id, gameId: payload?.payload?.gameId });
        // Refresh summary data when profits are calculated
        fetchSummaryData(table.id);
      } catch (e) {
        console.warn('[PokerTable] profits_calculated handler failed', e);
      }
    })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [table?.id]);

const [openPlayerModal, setOpenPlayerModal] = useState(false);
const [playerSearch, setPlayerSearch] = useState('');

// Helper to get sorted players (by total buy-ins desc)
const getSortedPlayers = () => {
  return [...players].sort((a, b) => {
    const aTotal = playerTotals[a.id] ?? 0;
    const bTotal = playerTotals[b.id] ?? 0;
    return bTotal - aTotal;
  });
};

// Helper to filter players by search
const getFilteredPlayers = (playersList: any[]) => {
  if (!playerSearch.trim()) return playersList;
  return playersList.filter(p => 
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );
};

return (
  <div 
    className="min-h-[100dvh] h-[100dvh] flex flex-col bg-[#0b0f10] text-slate-100 relative"
    style={showBackground ? {
      backgroundImage: `url('/Poker_05.png'), linear-gradient(135deg, #0f4c3a 0%, #2d5016 50%, #0f4c3a 100%)`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    } : undefined}
  >
    {/* Dark overlay for background image - semi-transparent */}
    {showBackground && (
      <div className="absolute inset-0 bg-black/75 pointer-events-none" style={{ zIndex: 1 }} />
    )}
    
    {/* Main content - positioned above overlay */}
    <div className="relative h-full flex flex-col pt-safe pb-safe px-3" style={{ zIndex: 10 }}>
      {/* Zone 1: Header + Actions (auto height, compact) */}
      <div className="flex-shrink-0 space-y-3">
        {/* Header */}
        <div className="rounded-2xl border border-emerald-700/25 bg-black/40 backdrop-blur-sm p-4">
          <div className="flex flex-col gap-3">
            <h1 className="text-xl font-bold tracking-tight text-white truncate text-center">
              {table.name || normalizedJoinCode}
            </h1>
            <div className="flex items-center justify-between gap-4">
              <div className="relative">
                <button
                  onClick={handleCopyJoinCode}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 shadow-sm"
                  title="Copy join code"
                  aria-label={`Copy join code: ${normalizedJoinCode}`}
                >
                  <span>{normalizedJoinCode}</span>
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copied && (
                  <div role="status" className="absolute -bottom-9 left-0 bg-slate-800 text-white text-xs px-2 py-1 rounded-md shadow-lg z-20">
                    Copied!
                  </div>
                )}
              </div>
              <div className="text-xs text-slate-300 text-right">
                <div>Admin: <span className="font-semibold text-white">{adminName || table.adminName || 'Loading...'}</span></div>
                {currentGame && (
                  <div className="text-emerald-300 font-semibold">
                    Game {currentGame.game_number}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Spectator Back to Selection */}
        {!isPlayerOnTable && !pendingJoinPlayerIds.has(profile?.id || '') && (
          <div className="py-3 px-3 border rounded-lg bg-black/60 border-emerald-700/30">
            <h3 className="font-semibold text-base mb-2 text-white">Viewing as spectator</h3>
            <p className="text-sm text-slate-200 mb-3">You are currently viewing this table as a spectator.</p>
            <Button
              onClick={onExit}
              className="w-full h-10 text-sm font-semibold bg-slate-600 hover:bg-slate-700 text-white border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/60"
              aria-label="Return to table selection"
            >
              <span role="img" aria-label="back arrow" className="mr-2">←</span> Back to Selection
            </Button>
          </div>
        )}

        {/* Player Actions */}
        {isPlayerOnTable && (
          <div className="rounded-2xl border border-emerald-700/25 bg-black/50 backdrop-blur-sm p-4">
            <h3 className="text-sm font-medium text-slate-200 mb-3">Actions</h3>
            
            {/* Primary Buy-in Button */}
            <Dialog open={openBuyIn} onOpenChange={setOpenBuyIn}>
              <DialogTrigger asChild>
                <button 
                  className="w-full h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-lg active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  aria-label="Request buy-in from table admin"
                >
                  <Banknote className="w-5 h-5" aria-hidden="true" />
                  Buy-in
                </button>
              </DialogTrigger>
              <DialogContent className="bg-black/90 backdrop-blur-md border-green-500/40 text-white max-w-sm w-80">
                <DialogHeader>
                  <DialogTitle className="text-lg font-bold text-white">Request Buy-in</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    if (processingBuyInRef.current || !amount.trim()) return;
                    processingBuyInRef.current = true;
                    setProcessingBuyIn(true);
                    handleRequestBuyIn();
                  }}
                  className="space-y-4"
                >
                  <Label htmlFor="amount" className="text-sm font-semibold text-gray-300">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="bg-gray-800/80 border-green-500/40 text-white placeholder-gray-400 focus:ring-green-500/50 focus:border-green-500/60 text-base h-11"
                    autoFocus
                  />
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={processingBuyInRef.current || !amount.trim()}
                      className="bg-green-600 hover:bg-green-700 text-white font-semibold h-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/60"
                      aria-label="Submit buy-in request"
                    >
                      {processingBuyIn ? 'Sending...' : 'Submit'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            {/* Secondary Actions Grid */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              {/* History button */}
              <HistoryDialog open={openHistory} onOpenChange={setOpenHistory}>
                <HistoryDialogTrigger asChild>
                  <button 
                    className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-slate-800/90 hover:bg-slate-700 text-white transition shadow-sm active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    aria-label="View buy-in history"
                  >
                    <ScrollText className="w-4 h-4" aria-hidden="true" />
                    History
                  </button>
                </HistoryDialogTrigger>
                <HistoryDialogContent
                  className="bg-black/90 backdrop-blur-md border-green-500/40 text-white max-w-md"
                  style={{ width: '400px', maxWidth: '90vw' }}
                >
                  <HistoryDialogHeader>
                    <HistoryDialogTitle className="text-lg font-bold text-white">Buy-in History</HistoryDialogTitle>
                  </HistoryDialogHeader>
                  <div style={{
                    fontSize: '14px',
                    overflowX: 'auto',
                    overflowY: 'auto',
                    maxHeight: '60vh'
                  }}>
                    <UITable>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-slate-200 font-semibold text-sm" style={{ minWidth: 80, padding: '8px' }}>Player</TableHead>
                          {(() => {
                            const playerBuyIns = players.map((p: any) =>
                              historyData.filter((row: any) => row.player_id === p.id)
                            );
                            const maxBuyIns = playerBuyIns.length ? Math.max(...playerBuyIns.map(arr => arr.length)) : 0;
                            return Array.from({ length: maxBuyIns }).map((_, idx) => (
                              <TableHead key={idx} className="text-slate-200 font-semibold text-sm text-right" style={{ minWidth: 50, padding: '8px' }}>
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
                            <TableRow key={p.id} className="border-b border-gray-700/40">
                              <TableCell className="text-white font-medium text-sm truncate" style={{ minWidth: 80, maxWidth: 120, padding: '8px' }}>{p.name}</TableCell>
                              {buyIns.map((row: any, idx: number) => (
                                <TableCell key={idx} className="text-emerald-300 font-mono text-right text-sm" style={{ minWidth: 50, padding: '8px' }}>
                                  {parseInt(row.amount, 10)}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </UITable>
                  </div>
                  <HistoryDialogFooter>
                    <Button variant="secondary" onClick={() => setOpenHistory(false)} className="bg-gray-700 hover:bg-gray-600 text-white font-semibold">Close</Button>
                  </HistoryDialogFooter>
                </HistoryDialogContent>
              </HistoryDialog>

              {/* End Up button */}
              <Dialog open={openEndUp} onOpenChange={setOpenEndUp}>
                <DialogTrigger asChild>
                  <button 
                    className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-slate-800/90 hover:bg-slate-700 text-white transition shadow-sm active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    aria-label="View end game calculations"
                  >
                    <Flag className="w-4 h-4" aria-hidden="true" />
                    End Up
                  </button>
                </DialogTrigger>
                <DialogContent
                  className="bg-black/90 backdrop-blur-md border-green-500/40 text-white max-w-md"
                  style={{
                    width: '400px',
                    maxWidth: '90vw',
                    padding: '16px',
                    height: '82vh',
                    maxHeight: '82vh',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  <DialogHeader className="flex-shrink-0 pb-3">
                    <DialogTitle className="text-lg font-bold text-white">End Up Game</DialogTitle>
                  </DialogHeader>
                  <div
                    style={{
                      fontSize: '12px',
                      flex: 1,
                      overflowX: 'auto',
                      overflowY: 'auto',
                      padding: '0',
                      minHeight: 0
                    }}
                  >
                    <UITable>
                      <TableHeader>
                        <TableRow className="border-b border-gray-600/40">
                          <TableHead className="text-slate-200 font-semibold text-xs text-left" style={{
                            padding: '4px 2px',
                            whiteSpace: 'nowrap',
                            fontSize: '11px'
                          }}>Player</TableHead>
                          <TableHead className="text-slate-200 font-semibold text-xs text-center" style={{
                            padding: '4px 2px',
                            whiteSpace: 'nowrap',
                            fontSize: '11px'
                          }}>Buy-ins</TableHead>
                          <TableHead className="text-slate-200 font-semibold text-xs text-center" style={{
                            padding: '4px 2px',
                            fontSize: '11px'
                          }}>End Up</TableHead>
                          <TableHead className="text-slate-200 font-semibold text-xs text-center" style={{
                            padding: '4px 2px',
                            fontSize: '11px'
                          }}>Profit/7</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.isArray(players) && players.map((p: any) => {
                          const totalBuyIns = parseInt(String(playerTotals[p.id] ?? 0), 10);
                          const endUp = endUpValues[p.id] ?? 0;
                          const profitDiv7 = calculatePlayerProfit(p.id, endUp, totalBuyIns).toFixed(2);
                          return (
                            <TableRow
                              key={p.id}
                              className="border-b border-gray-700/40"
                              style={{ minHeight: 32 }}
                            >
                              <TableCell className="text-white font-medium text-xs truncate" style={{
                                padding: '4px 2px',
                                height: 32,
                                verticalAlign: 'middle',
                                maxWidth: '80px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                fontSize: '12px'
                              }}>{p.name}</TableCell>
                              <TableCell className="text-emerald-300 font-mono text-right text-xs" style={{
                                padding: '4px 2px',
                                height: 32,
                                verticalAlign: 'middle',
                                fontSize: '14px'
                              }}>
                                {totalBuyIns}
                              </TableCell>
                              <TableCell style={{
                                padding: '4px 2px',
                                textAlign: 'right',
                                height: 32,
                                verticalAlign: 'middle',
                              }}>
                                <Input
                                  type="number"
                                  step="any"
                                  disabled={!isAdmin}
                                  className="bg-gray-800/80 border-green-500/40 text-emerald-300 placeholder-gray-400 focus:ring-green-500/50 focus:border-green-500/60 text-xs font-mono text-right"
                                  style={{
                                    width: '100%',
                                    height: 28,
                                    fontSize: '16px',
                                    padding: '2px 6px'
                                  }}
                                  value={endUp}
                                  onChange={e => handleEndUpChange(p.id, parseFloat(e.target.value || '0'))}
                                />
                              </TableCell>
                              <TableCell className="text-emerald-300 font-mono text-right text-xs" style={{
                                padding: '4px 2px',
                                height: 32,
                                verticalAlign: 'middle',
                                fontSize: '14px'
                              }}>
                                {profitDiv7}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {/* Summary Row */}
                        {(() => {
                          const totalBuyIns = players.reduce((sum, p) => sum + parseInt(String(playerTotals[p.id] ?? 0), 10), 0);
                          const totalEndUp = players.reduce((sum, p) => sum + (endUpValues[p.id] ?? 0), 0);
                          const totalProfit = calculatePlayerProfit('total', totalEndUp, totalBuyIns);
                          
                          return (
                            <TableRow className="border-t-2 border-emerald-500/50 bg-emerald-900/20">
                              <TableCell className="text-emerald-200 font-bold text-xs" style={{
                                padding: '6px 2px',
                                height: 36,
                                verticalAlign: 'middle',
                                fontSize: '12px'
                              }}>
                                TOTAL
                              </TableCell>
                              <TableCell className="text-emerald-200 font-bold text-right text-xs" style={{
                                padding: '6px 2px',
                                height: 36,
                                verticalAlign: 'middle',
                                fontSize: '14px'
                              }}>
                                {totalBuyIns}
                              </TableCell>
                              <TableCell className="text-emerald-200 font-bold text-right text-xs" style={{
                                padding: '6px 2px',
                                height: 36,
                                verticalAlign: 'middle',
                                fontSize: '14px'
                              }}>
                                {totalEndUp.toFixed(0)}
                              </TableCell>
                              <TableCell className="text-emerald-200 font-bold text-right text-xs" style={{
                                padding: '6px 2px',
                                height: 36,
                                verticalAlign: 'middle',
                                fontSize: '14px'
                              }}>
                                {totalProfit.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        })()}
                      </TableBody>
                    </UITable>
          </div>
          <DialogFooter className="flex-shrink-0 mt-3">
            {isAdmin ? (
              <div className="flex gap-2 w-full">
                <Button 
                  variant="secondary" 
                  onClick={() => setOpenEndUp(false)} 
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold"
                >
                  Close
                </Button>
                <Button 
                  onClick={handleSaveEndUp} 
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold"
                >
                  Save End Up
                </Button>
              </div>
            ) : (
              <Button 
                variant="secondary" 
                onClick={() => setOpenEndUp(false)} 
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold"
              >
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

              {/* Summary button - Available for all players */}
              <Dialog open={openSummary} onOpenChange={setOpenSummary}>
                <DialogTrigger asChild>
                  <button
                    onClick={() => fetchSummaryData(table?.id || '')}
                    className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-slate-800/90 hover:bg-slate-700 text-white transition shadow-sm active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    aria-label="View game summary and profits"
                  >
                    <BarChart3 className="w-4 h-4" aria-hidden="true" />
                    Summary
                  </button>
                </DialogTrigger>
                <DialogContent
                  className="bg-black/90 backdrop-blur-md border-blue-500/40 text-white max-w-2xl"
                  style={{ width: '600px', maxWidth: '90vw' }}
                >
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-white">Game Summary</DialogTitle>
                  </DialogHeader>
                  <div
                    style={{
                      fontSize: '14px',
                      overflowX: 'auto',
                      overflowY: 'auto',
                      maxHeight: '60vh'
                    }}
                  >
                    <UITable>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-slate-200 font-semibold text-sm" style={{ minWidth: 120, padding: '8px' }}>
                            Player
                          </TableHead>
                          <TableHead className="text-slate-200 font-semibold text-sm text-right" style={{ minWidth: 100, padding: '8px' }}>
                            Total
                          </TableHead>
                          {summaryData[0]?.gameNumbers.map((gameNum) => (
                            <TableHead 
                              key={gameNum} 
                              className="text-slate-200 font-semibold text-xs text-right" 
                              style={{ 
                                minWidth: 70, 
                                padding: '4px',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              G{gameNum}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaryData.map((player, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-white font-medium text-sm" style={{ padding: '8px' }}>
                              {player.playerName}
                            </TableCell>
                            <TableCell 
                              className={`font-mono text-sm font-bold text-right ${
                                player.totalProfit >= 0 ? 'text-emerald-300' : 'text-red-300'
                              }`}
                              style={{ padding: '8px' }}
                            >
                              {(player.totalProfit >= 0 ? '+' : '') + player.totalProfit.toFixed(2)}
                            </TableCell>
                            {player.gameResults.map((profit, gameIdx) => (
                              <TableCell 
                                key={gameIdx} 
                                className={`font-mono text-xs text-right ${
                                  profit === null ? 'text-gray-500' : 
                                  profit >= 0 ? 'text-emerald-300' : 'text-red-300'
                                }`}
                                style={{ padding: '4px' }}
                              >
                                {profit === null ? '-' : 
                                 (profit >= 0 ? '+' : '') + profit.toFixed(1)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </UITable>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => setOpenSummary(false)}
                      className="bg-gray-700 hover:bg-gray-600 text-white font-semibold"
                    >
                      Close
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Edit Profile button */}
              <Dialog open={openEditProfile} onOpenChange={setOpenEditProfile}>
                <DialogTrigger asChild>
                  <button
                    className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-slate-800/90 hover:bg-slate-700 text-white transition shadow-sm active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    onClick={() => {
                      setEditName(profile?.name || '');
                      setEditError('');
                      setOpenEditProfile(true);
                    }}
                    aria-label="Edit your profile name"
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    Edit Profile
                  </button>
                </DialogTrigger>
                <DialogContent className="bg-black/90 backdrop-blur-md border-green-500/40 text-white max-w-sm w-80">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-white">Edit Profile</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    handleEditProfileSubmit();
                  }}>
                    <div className="space-y-4">
                      <Label htmlFor="editName" className="text-sm font-semibold text-gray-300">New Name</Label>
                      <Input
                        id="editName"
                        value={editName}
                        onChange={handleEditNameChange}
                        className="bg-gray-800/80 border-green-500/40 text-white placeholder-gray-400 focus:ring-green-500/50 focus:border-green-500/60 text-base h-11"
                        maxLength={30}
                        autoFocus
                      />
                      {editError && (
                        <div className="text-red-400 text-sm font-semibold mt-2">{editError}</div>
                      )}
                    </div>
                    <DialogFooter className="mt-6">
                      <Button
                        type="submit"
                        disabled={editSubmitting || !editName.trim()}
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold h-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/60"
                        aria-label="Save profile changes"
                      >
                        {editSubmitting ? 'Saving...' : 'Save'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {/* Start New Game button - Admin only */}
              {isAdmin && (
                <Dialog open={openStartNewGame} onOpenChange={setOpenStartNewGame}>
                  <DialogTrigger asChild>
                    <button
                      className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white transition shadow-sm active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
                      aria-label="Start a new game"
                    >
                      <Play className="w-4 h-4" aria-hidden="true" />
                      Start New Game
                    </button>
                  </DialogTrigger>
                  <DialogContent className="bg-black/90 backdrop-blur-md border-emerald-500/40 text-white max-w-sm w-80">
                    <DialogHeader>
                      <DialogTitle className="text-lg font-bold text-white">Start New Game</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                      <p className="text-gray-300 leading-relaxed">
                        This will end the current game, calculate profits, and start a new game.
                      </p>
                      <p className="text-gray-300 text-sm leading-relaxed">
                        All buy-ins and end-up values will be reset for the new game.
                      </p>
                      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3">
                        <p className="text-emerald-200 font-semibold">
                          Current Game: {currentGame?.game_number || 'None'}
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="secondary"
                        onClick={() => setOpenStartNewGame(false)}
                        className="bg-gray-700 hover:bg-gray-600 text-white font-semibold"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleStartNewGame}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                        aria-label="Confirm start new game"
                      >
                        Start New Game
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {/* Exit Table button */}
              <Dialog open={openExit} onOpenChange={setOpenExit}>
                <DialogTrigger asChild>
                  <button
                    className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white transition shadow-sm active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    disabled={processingExit}
                    aria-label="Exit poker table"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    Exit Table
                  </button>
                </DialogTrigger>
                <DialogContent className="bg-black/90 backdrop-blur-md border-red-500/40 text-white max-w-sm w-80">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-white">Exit Game</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 text-sm">
                    <p className="text-gray-300 leading-relaxed">You will be moved to the table selection page.</p>
                    <p className="text-gray-300 text-sm leading-relaxed">Click Yes to continue.</p>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => setOpenExit(false)}
                      disabled={processingExit}
                      className="bg-gray-700 hover:bg-gray-600 text-white font-semibold"
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
                      className="bg-red-600 hover:bg-red-700 text-white font-semibold"
                      aria-label="Confirm exit from poker table"
                    >
                      Yes, Exit Table
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        )}

        {/* Admin Pending Requests */}
        {isAdmin && (pendingRequests.length > 0 || pendingJoinRequests.length > 0) && (
          <div className="bg-black/60 border border-red-500/40 rounded-lg py-3 px-3">
            <h3 className="text-white text-sm font-semibold mb-2">Pending Requests</h3>
            
            {/* Buy-in requests */}
            {pendingRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-2 mb-2 border rounded border-slate-600/40 bg-slate-800/40">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm truncate">
                    {players.find((p: any) => p.id === r.player_id)?.name || r.player_id}
                  </div>
                  <div className={`font-mono text-lg text-right ${r.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {`${r.amount >= 0 ? '+' : ''}${r.amount.toFixed(0)}`}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0 ml-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(r.id)}
                    disabled={processingRequests.includes(r.id)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-8 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    aria-label={`Approve buy-in request for ${players.find((p: any) => p.id === r.player_id)?.name || 'player'}`}
                  >
                    ✓
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs h-8 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                    onClick={() => handleReject(r.id)}
                    disabled={processingRequests.includes(r.id)}
                    aria-label={`Reject buy-in request for ${players.find((p: any) => p.id === r.player_id)?.name || 'player'}`}
                  >
                    ✗
                  </Button>
                </div>
              </div>
            ))}

            {/* Join requests */}
            {pendingJoinRequests.map((r) => {
              const playerObj = players.find((p: any) => p.id === r.player_id);
              const displayName = playerObj?.name || r.player_name || '';
              return (
                <div key={r.id} className="flex items-center justify-between p-2 mb-2 border rounded border-slate-600/40 bg-slate-800/40">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white text-sm truncate">{displayName}</div>
                    <div className="text-slate-200 text-xs">Join request</div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0 ml-2">
                    <Button 
                      size="sm" 
                      onClick={() => handleApproveJoin(r.id)}
                      disabled={processingJoinRequests.includes(r.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-8 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      aria-label={`Approve join request for ${displayName}`}
                    >
                      ✓
                    </Button>
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs h-8 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                      onClick={() => handleRejectJoin(r.id)}
                      disabled={processingJoinRequests.includes(r.id)}
                      aria-label={`Reject join request for ${displayName}`}
                    >
                      ✗
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Zone 2: Summary Row (auto height, compact) */}
      {isPlayerOnTable && (
        <div className="flex-shrink-0 my-3">
          <div className="rounded-2xl border border-emerald-700/25 bg-black/40 backdrop-blur-sm p-4 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-300">Your Buy-ins</div>
              <div className="text-4xl md:text-5xl font-extrabold text-emerald-300 font-mono tabular-nums">
                {parseInt(String(playerTotals[profile?.id] ?? 0), 10)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-sm text-slate-300">
                Total Pot ({players.length} player{players.length !== 1 ? 's' : ''})
              </div>
              <div className="text-lg md:text-xl font-semibold text-emerald-300 font-mono tabular-nums">
                {Object.values(playerTotals).reduce((sum, v) => sum + parseInt(String(v), 10), 0)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zone 3: Players Section (collapsed preview) */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="rounded-2xl border border-emerald-700/30 bg-black/40 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between py-3 px-3 flex-shrink-0">
            <h3 className="text-base font-semibold text-white">All Players</h3>
            <button
              onClick={() => setOpenPlayerModal(true)}
              className="text-sm text-emerald-300 hover:text-emerald-200 font-medium flex-shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 px-1"
              aria-label={`View all ${players.length} players`}
            >
              Show all ({players.length})
            </button>
          </div>
          
          {/* Preview list - top 5 players only */}
          <div className="overflow-y-auto">
            {getSortedPlayers().slice(0, 5).map((p: any, index: number) => {
              const isPending = !!p.pending;
              const isInactive = !p.pending && p.active === false;
              const total = parseInt(String(playerTotals[p.id] ?? 0), 10);
              
              return (
                <div 
                  key={p.id} 
                  className="flex items-center justify-between px-3 py-2 md:py-3 border-t border-emerald-800/10"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="truncate max-w-[60%] text-sm font-medium text-white">{p.name}</span>
                    {isPending && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/90 text-white font-semibold flex-shrink-0">
                        Pending
                      </span>
                    )}
                    {isInactive && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-slate-600/80 text-white font-medium flex-shrink-0">
                        Exited
                      </span>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-base md:text-lg font-semibold text-emerald-300 font-mono tabular-nums">
                      {total}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Full-screen Player Modal */}
      {openPlayerModal && (
        <div className="fixed inset-0 bg-black/70 z-50">
          <div className="p-3 h-full">
            <div className="rounded-2xl bg-[#0f1419] border border-emerald-700/30 h-full flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between py-3 px-4 border-b border-emerald-800/20 flex-shrink-0">
                <h2 className="text-lg font-semibold text-white">
                  All Players ({players.length})
                </h2>
                <button
                  onClick={() => setOpenPlayerModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-200 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  aria-label="Close player list modal"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Search Input */}
                <div className="py-3 px-4 border-b border-emerald-800/20">
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={playerSearch}
                    onChange={(e) => setPlayerSearch(e.target.value)}
                    className="w-full h-10 rounded-lg bg-slate-800/70 px-3 text-sm text-white placeholder-slate-300 border border-slate-600/50 focus:border-emerald-500/50 focus:outline-none"
                    aria-label="Search players by name"
                  />
                </div>

                {/* Player List */}
                <div>
                  {getFilteredPlayers(getSortedPlayers()).map((p: any, index: number) => {
                    const isPending = !!p.pending;
                    const isInactive = !p.pending && p.active === false;
                    const total = parseInt(String(playerTotals[p.id] ?? 0), 10);
                    
                    return (
                      <div 
                        key={p.id} 
                        className="flex items-center justify-between py-2 md:py-3 px-4 border-b border-emerald-800/10 hover:bg-emerald-950/20"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="font-medium text-white text-sm truncate">{p.name}</span>
                          {isPending && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/90 text-white font-semibold flex-shrink-0">
                              Pending
                            </span>
                          )}
                          {isInactive && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-slate-600/80 text-white font-medium flex-shrink-0">
                              Exited
                            </span>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-base md:text-lg font-semibold text-emerald-300 font-mono tabular-nums">
                            {total}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer with Close Button */}
              <div className="flex-shrink-0 border-t border-emerald-800/20 p-4">
                <Button
                  onClick={() => setOpenPlayerModal(false)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-12 rounded-xl transition shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  aria-label="Close player list and return to poker table"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Dialog */}
      <HistoryDialog open={openHistory} onOpenChange={setOpenHistory}>
        <HistoryDialogContent
          className="bg-black/90 backdrop-blur-md border-green-500/40 text-white max-w-md"
          style={{ width: '400px', maxWidth: '90vw' }}
        >
          <HistoryDialogHeader>
            <HistoryDialogTitle className="text-lg font-bold text-white">Buy-in History</HistoryDialogTitle>
          </HistoryDialogHeader>
          <div style={{
            fontSize: '14px',
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: '60vh'
          }}>
            <UITable>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-slate-200 font-semibold text-sm" style={{ minWidth: 80, padding: '8px' }}>Player</TableHead>
                  {(() => {
                    const playerBuyIns = players.map((p: any) =>
                      historyData.filter((row: any) => row.player_id === p.id)
                    );
                    const maxBuyIns = playerBuyIns.length ? Math.max(...playerBuyIns.map(arr => arr.length)) : 0;
                    return Array.from({ length: maxBuyIns }).map((_, idx) => (
                      <TableHead key={idx} className="text-slate-200 font-semibold text-sm text-right" style={{ minWidth: 50, padding: '8px' }}>
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
                    <TableRow key={p.id} className="border-b border-gray-700/40">
                      <TableCell className="text-white font-medium text-sm truncate" style={{ minWidth: 80, maxWidth: 120, padding: '8px' }}>{p.name}</TableCell>
                      {buyIns.map((row: any, idx: number) => (
                        <TableCell key={idx} className="text-emerald-300 font-mono text-right text-sm" style={{ minWidth: 50, padding: '8px' }}>
                          {parseInt(row.amount, 10)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </UITable>
          </div>
          <HistoryDialogFooter>
            <Button variant="secondary" onClick={() => setOpenHistory(false)} className="bg-gray-700 hover:bg-gray-600 text-white font-semibold">Close</Button>
          </HistoryDialogFooter>
        </HistoryDialogContent>
      </HistoryDialog>

      {/* Exit Dialog */}
      <Dialog open={openExit} onOpenChange={setOpenExit}>
        <DialogContent className="bg-black/90 backdrop-blur-md border-red-500/40 text-white max-w-sm w-80">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Exit Game</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-gray-300 leading-relaxed">You will be moved to the table selection page.</p>
            <p className="text-gray-300 text-sm leading-relaxed">Click Yes to continue.</p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setOpenExit(false)}
              disabled={processingExit}
              className="bg-gray-700 hover:bg-gray-600 text-white font-semibold"
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
              className="bg-red-600 hover:bg-red-700 text-white font-semibold"
              aria-label="Confirm exit from poker table"
            >
              Yes, Exit Table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </div>
  );
};

/*
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
*/

export default PokerTable;