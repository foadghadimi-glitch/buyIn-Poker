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

const PokerTable = ({ table: propTable }: { table?: PokerTableRow }) => {
  // dev-only: log when propTable identity changes (avoid logging every render)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[PokerTable] propTable changed:', propTable?.id ? { id: propTable.id, name: propTable.name } : propTable);
    }
  }, [propTable?.id]);
  const navigate = useNavigate();
  const profile = storage.getProfile();
  const [table, setTable] = useState<any>(propTable || storage.getTable());
  // Keep table state locked to incoming propTable when provided (avoid transient null state)
  useEffect(() => {
    if (propTable && propTable.id) {
      setTable(propTable);
    }
  }, [propTable]);
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

  // Add new state to hold players loaded from table_players + players table
  const [players, setPlayers] = useState<TablePlayer[]>(table?.players || []);

  // Track join-request IDs we've already shown notifications for to avoid duplicate toasts.
  // Use a Map<requestId, timestamp> with short TTL so re-subscribes within TTL won't re-show.
  const shownJoinRequestIdsRef = useRef<Map<string, number>>(new Map());
  const NOTIF_TTL_MS = 1000 * 60 * 5; // 5 minutes

  // Track player IDs that currently have a pending join_request for this table
  const [pendingJoinPlayerIds, setPendingJoinPlayerIds] = useState<Set<string>>(new Set());

  // Keep pending join requests in sync (used by loadPlayersFromJoinTable to mark pending)
  useEffect(() => {
    if (!table?.id) return;
    let mounted = true;
    const fetchPending = async () => {
      try {
        const { data, error } = await supabase
          .from('join_requests')
          .select('player_id')
          .eq('table_id', table.id)
          .eq('status', 'pending');
        if (!error && mounted) {
          setPendingJoinPlayerIds(new Set((data || []).map((r: any) => r.player_id).filter(Boolean)));
        } else if (mounted) {
          setPendingJoinPlayerIds(new Set());
        }
      } catch (e) {
        if (mounted) setPendingJoinPlayerIds(new Set());
      }
    };
    fetchPending();

    const channel = supabase
      .channel('join_requests_client_' + table.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'join_requests', filter: `table_id=eq.${table.id}` },
        () => { fetchPending(); }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [table?.id]);

  // Recompute players whenever pending join IDs or totals change (ensures UI reflects pending state immediately)
  useEffect(() => {
    if (!table?.id) return;
    loadPlayersFromJoinTable(table.id);
  }, [pendingJoinPlayerIds, playerTotals, table?.id]);

  // New helper: fetch totals for a table and update playerTotals + players
  const fetchTotals = async (tableId?: string) => {
    const id = tableId || table?.id;
    if (!id) return;
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
      }
    } catch (e) {
      console.warn('[PokerTable] fetchTotals error (ignored):', e);
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
        // Simplified query - only use player_id since our schema doesn't have user_id
        let tpRow = null;
        let error = null;
        
        // Find by player_id only (our schema only has player_id)
        const { data: playerRow, error: playerError } = await supabase
          .from('table_players')
          .select('status, player_id')
          .eq('table_id', id)
          .eq('player_id', profile.id)
          .maybeSingle();
          
        if (playerRow) {
          tpRow = playerRow;
        } else {
          error = playerError;
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
            await loadPlayersFromJoinTable(table.id);
            await fetchTotals(table.id);
            await ensureCurrentPlayerActive(table.id);

            // Dev: after reconciliation, log admin rejoin snapshot so regular clients show it
            if (process.env.NODE_ENV !== 'production' && newRow && newRow.player_id === table?.admin_player_id && newRow.status === 'active') {
              const adminPlayer = players.find(p => p.id === table.admin_player_id);
              const totalsSnapshot = { playerTotals, totalPlayers: players.length, adminId: table.admin_player_id, adminName: adminPlayer?.name || null };
              console.debug('[PokerTable] Admin rejoined (reconciled):', totalsSnapshot);
            }
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
                await loadPlayersFromJoinTable(table.id);
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
  // If a join_request is created and the player already has a table_players row for this table
  // (i.e. they were a member before), automatically activate them and remove the join_request.
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
 
             // Check if this player had a prior membership row in table_players for this table
             const { data: prior, error: priorErr } = await supabase
               .from('table_players')
               .select('*')
               .eq('table_id', table.id)
               .eq('player_id', playerId)
               .maybeSingle();
             if (priorErr) {
               console.warn('[PokerTable] Error checking prior membership for auto-approve:', priorErr);
               return;
             }
 
             // If prior membership exists (even inactive), auto-activate and delete join_request.
             if (prior) {
               // Upsert to set active (use update if exists, insert if not)
               if (prior.id) {
                 await supabase
                   .from('table_players')
                   .update({ status: 'active' })
                   .match({ table_id: table.id, player_id: playerId });
               } else {
                 await supabase
                   .from('table_players')
                   .insert({ table_id: table.id, player_id: playerId, status: 'active' });
               }
 
               // Remove the join_request (so admin is not notified for this case)
               await supabase.from('join_requests').delete().eq('id', newReq.id);
 
               // Update local pending lists + players
               setPendingJoinRequests(prev => prev.filter((r: any) => r.id !== newReq.id));
               setPendingJoinPlayerIds(prev => {
                 const next = new Set(prev);
                 next.delete(playerId);
                 return next;
               });
               await loadPlayersFromJoinTable(table.id);
             }
           } catch (e) {
             console.error('[PokerTable] auto-approve join_request handler error:', e);
           }
         }
       )
       .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [table?.id]);

  // New helper to fetch pending join_request player IDs for a table
  const fetchPendingJoinIds = async (tableId?: string) => {
    const id = tableId || table?.id;
    if (!id) return;
    try {
      const { data } = await supabase
        .from('join_requests')
        .select('player_id')
        .eq('table_id', id)
        .eq('status', 'pending');
      setPendingJoinPlayerIds(new Set((data || []).map((r: any) => r.player_id).filter(Boolean)));
    } catch (e) {
      // keep previous state instead of clearing on transient error
      console.warn('[PokerTable] fetchPendingJoinIds failed (ignored):', e);
    }
  };

  // Ensure a consistent init when a table becomes available (helps after navigation back)
  useEffect(() => {
    if (!table?.id) return;
    (async () => {
      await fetchPendingJoinIds(table.id);
      await loadPlayersFromJoinTable(table.id);
      await fetchTotals(table.id);
      // If current user already has an active table_players row, clear pending/exited markers
      await ensureCurrentPlayerActive(table.id);
    })();
  }, [table?.id]);

  // New helper: load players for a table from table_players -> players
  const loadPlayersFromJoinTable = async (tableId: string) => {
    if (!tableId) return;
    try {
       // Fetch join records (adjust column name user_id/player_id as applicable)
       const { data: joinRows, error: joinError } = await supabase
         .from('table_players')
         .select('*')
         .eq('table_id', tableId);

       if (joinError) {
         // transient load failure: log but keep previous players to avoid flicker/clearing
         console.error('Error fetching table_players (transient):', joinError);
         return;
       }

        // map player id -> status from joinRows
        const statusById: Record<string, string | undefined> = {};
        (joinRows || []).forEach((r: any) => {
          const pid = r.player_id;
          if (pid) statusById[pid] = r.status;
        });

        const ids = (joinRows || [])
          .map((r: any) => r.player_id) // only use player_id
          .filter(Boolean);

        if (ids.length === 0) {
          setPlayers([]);
          return;
        }

       const { data: playersData, error: playersError } = await supabase
         .from('players')
         .select('id,name')
         .in('id', ids);

       if (playersError) {
         console.error('Error fetching players rows (transient):', playersError);
         return;
       }

        // Merge with totals if available
      const newPlayers: TablePlayer[] = (playersData || []).map((p: any) => {
        const status = statusById[p.id]; // 'active' | 'inactive' | undefined
        const hasPending = pendingJoinPlayerIds.has(p.id);

        // Prefer DB 'active' status. If DB says active, treat as active regardless of stale pending flags.
        // If DB says 'inactive' but there is a pending join_request, show pending.
        // If DB has no status (undefined), keep previous behavior: treat as active unless there is a pending request.
        const isActiveByDb = status === 'active' || (status === undefined && !hasPending);
        const pending = !isActiveByDb && hasPending;
        const active = !!isActiveByDb;

        return {
          id: p.id,
          name: p.name,
          totalPoints: playerTotals[p.id] ?? 0,
          active,
          pending
        };
      });

      // Merge with previous players state to avoid clobbering a recently-detected active flag
      // for the current profile (prevents a racing stale load from re-marking admin as Exited).
      setPlayers(prev => {
        // If prev had the current user marked active, keep them active.
        const prevCurrent = prev.find(x => x.id === profile?.id);
        return newPlayers.map(np => {
          if (np.id === profile?.id && prevCurrent?.active) {
            return { ...np, active: true, pending: false };
          }
          return np;
        });
      });
       // Ensure current player's active state is reflected immediately (handles admin rejoin races)
       try {
         await ensureCurrentPlayerActive(tableId);
       } catch (e) {
         /* ignore */
       }
     } catch (e) {
       console.error('loadPlayersFromJoinTable unexpected error (keep previous players):', e);
     }
  };

  // Fetch admin name when table changes
  useEffect(() => {
    const fetchAdminName = async () => {
      // Clear stale admin name immediately if there's no admin id
      if (!table?.admin_player_id) {
        setAdminName('');
        return;
      }
      // use maybeSingle to avoid 406 when admin_player_id doesn't exist in players
      try {
        const { data: adminPlayer, error } = await supabase
          .from('players')
          .select('name')
          .eq('id', table.admin_player_id)
          .maybeSingle();
        if (!error && adminPlayer) {
          setAdminName(adminPlayer.name);
        } else {
          // fallback: clear stale value if lookup failed or returned nothing
          setAdminName('');
        }
      } catch (e) {
        console.warn('[PokerTable] fetchAdminName failed (ignored):', e);
        setAdminName('');
      }
    };
    fetchAdminName();
  }, [table?.admin_player_id]);

  // --- NEW: ensure admin player's UI state is marked active immediately for all viewers ---
  // This avoids showing "(Exited)" for the admin after they rejoin.
  useEffect(() => {
    const adminId = table?.admin_player_id;
    if (!adminId) return;

    // Fast local update so other viewers see admin as active immediately.
    setPlayers(prev => {
      // If admin exists in the local list, mark active/pending appropriately.
      if (prev.some(p => p.id === adminId)) {
        return prev.map(p => p.id === adminId ? { ...p, active: true, pending: false } : p);
      }
      // If admin isn't present, leave list alone; reconcilers will fetch & inject.
      return prev;
    });

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[PokerTable] marked admin active locally for id:', adminId);
    }
  // Depend on admin id only — keep this lightweight
  }, [table?.admin_player_id]);

  // Move isAdmin definition before useEffect
  const isAdmin = profile?.id === table?.admin_player_id;

  // Add real-time subscription for table changes (admin changes, join code, name, etc.)
  useEffect(() => {
    if (!table?.id) return;

    const tableChannel = supabase
      .channel('table_changes_' + table.id)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'poker_tables',
          filter: `id=eq.${table.id}`
        },
        async payload => {
          if (process.env.NODE_ENV !== 'production') console.debug('Table updated:', payload);
           // Update the local table state with new data
           setTable((prev: any) => ({
             ...prev,
             ...payload.new
             // do not rely on payload.new.players (schema may not have it)
           }));
           // Refresh players from join table when table changes
           try {
             await loadPlayersFromJoinTable(payload.new?.id || table.id);
           } catch (e) {
             console.error('Error reloading players after table change', e);
           }
         }
       )
       .subscribe();

     return () => {
       supabase.removeChannel(tableChannel);
     };
   }, [table?.id]);

  // On page refresh, fetch latest table data
  useEffect(() => {
    const fetchLatestTableData = async () => {
      if (!table?.id) return;

      const { data: tableData, error } = await supabase
        .from('poker_tables')
        .select('*')
        .eq('id', table.id)
        .single();

      if (!error && tableData) {
        setTable(tableData);
        storage.setTable(tableData);
        // load players separately from join table
        await loadPlayersFromJoinTable(tableData.id);
      }
    };

    fetchLatestTableData();
  }, []);

  useEffect(() => {
    // debug: avoid noisy logs on every table object identity change
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[PokerTable] useEffect (fetch table) - table.id:', table?.id, 'profile.id:', profile?.id);
    }
    if (!table && profile) {
      const fetchTable = async () => {
        const localTable = storage.getTable();
        if (localTable) {
          setTable(localTable);
          // try loading players for the stored table
          if (localTable.id) await loadPlayersFromJoinTable(localTable.id);
          return;
        }
        // use maybeSingle so absence of a row doesn't trigger a 406
        const { data, error } = await supabase
          .from('poker_tables')
          .select('*')
          .eq('admin_player_id', profile.id)
          .maybeSingle();
        if (!error && data) {
          setTable(data);
          await loadPlayersFromJoinTable(data.id);
        }
      };
      fetchTable();
    }
  }, [profile?.id, table?.id]);

  useEffect(() => {
    // Fetch pending buy-in requests for this table
    const fetchRequests = async () => {
      if (!table?.id) return;
      const { data, error } = await supabase
        .from('buy_in_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      if (!error && data) setPendingRequests(data);
    };
    fetchRequests();
  }, [table?.id, openBuyIn]);

  useEffect(() => {
    // Fetch total approved buy-ins for each player in the table
    const fetchTotalsEffect = async () => {
      if (!table?.id) return;
      const { data, error } = await supabase
        .from('buy_ins')
        .select('player_id, amount')
        .eq('table_id', table.id) as any;
      if (!error && data) {
        const totals: Record<string, number> = {};
        (data as Array<{ player_id: string; amount: number }>).forEach((row) => {
          totals[row.player_id] = (totals[row.player_id] || 0) + Number(row.amount);
        });
        setPlayerTotals(totals);
        // Refresh players to include latest totals
        setPlayers(prev => prev.map(p => ({ ...p, totalPoints: totals[p.id] ?? 0 })));
      }
    };
    fetchTotalsEffect();
  }, [table?.id, pendingRequests]);

  // Fetch pending join requests for this table (for admin)
  useEffect(() => {
    if (!table || !isAdmin) return;

    // Initial fetch + enrich with player names from players table
    const fetchJoinRequests = async () => {
      const { data: reqs, error: reqErr } = await supabase
        .from('join_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      if (reqErr || !reqs) {
        setPendingJoinRequests([]);
        return;
      }
      const playerIds = Array.from(new Set(reqs.map((r: any) => r.player_id).filter(Boolean)));
      if (playerIds.length === 0) {
        setPendingJoinRequests(reqs);
        return;
      }
      const { data: playersData } = await supabase
        .from('players')
        .select('id,name')
        .in('id', playerIds);
      const nameById: Record<string, string> = {};
      (playersData || []).forEach((p: any) => { nameById[p.id] = p.name; });
      const enriched = reqs.map((r: any) => ({ ...r, player_name: nameById[r.player_id] || undefined }));
      setPendingJoinRequests(enriched);
    };
    fetchJoinRequests();

    // Subscribe to real-time changes for join requests (already present)
    const joinChannel = supabase
      .channel('join_requests_admin_' + table.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'join_requests',
          filter: `table_id=eq.${table.id}`
        },
        payload => {
          fetchJoinRequests();
        }
      )
      .subscribe();

    // Helper to fetch pending buy-in requests
    const fetchPendingBuyIns = async () => {
      const { data, error } = await supabase
        .from('buy_in_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      if (!error && data) setPendingRequests(data);
    };

    // Initial fetch of pending buy-ins
    fetchPendingBuyIns();

    // --- Add real-time subscription for buy-in requests ---
    const buyInChannel = supabase
      .channel('buy_in_requests_admin_' + table.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'buy_in_requests',
          filter: `table_id=eq.${table.id}`
        },
        payload => {
          // Refresh pending list
          fetchPendingBuyIns();
          // If a new request was inserted, show a toast to the admin
          const evt = (payload as any)?.eventType || (payload as any)?.event;
          const newRow: any = (payload as any)?.new;
          if (evt === 'INSERT' && newRow && newRow.table_id === table.id) {
            const amount = newRow.amount;
            const playerId = newRow.player_id;
            // Fire-and-forget attempt to get player name (non-blocking)
            (async () => {
              try {
                const { data: p } = await supabase
                  .from('players')
                  .select('name')
                  .eq('id', playerId)
                  .maybeSingle();
                const who = p?.name || 'A player';
                toast('New buy-in request', { description: `${who} requested ${amount}` });
              } catch {
                toast('New buy-in request', { description: `Amount: ${amount}` });
              }
            })();
          }
        }
      )
      .subscribe();

    // Polling fallback in case realtime is temporarily disconnected
    const pollInterval = setInterval(fetchPendingBuyIns, 6000);

    return () => {
      supabase.removeChannel(joinChannel);
      supabase.removeChannel(buyInChannel);
      clearInterval(pollInterval);
    };
  }, [table?.id, isAdmin]);

  // Listen for broadcast notifications for new join requests (admin only)
  useEffect(() => {
    // depend on table?.id only to avoid frequent re-subscribes when table object identity changes
    if (!table?.id || !isAdmin || !profile?.id) return;

    const notifChannel = supabase
      .channel('user_' + profile.id)
      .on('broadcast', { event: 'join_request_created' }, async (payload) => {
        try {
          const reqId = payload?.payload?.requestId;
          if (!reqId) return;
          // Deduplicate by request id with TTL
          const shownMap = shownJoinRequestIdsRef.current;
          const prevTs = shownMap.get(reqId);
          if (prevTs && (Date.now() - prevTs) < NOTIF_TTL_MS) return;

           // If we have a requestId, fetch the join_request row first to decide behavior
           if (reqId) {
             const { data: reqRow, error: reqRowErr } = await supabase
               .from('join_requests')
               .select('*')
               .eq('id', reqId)
               .maybeSingle();
             // If row not found or error, ignore (it may have been auto-handled)
             if (reqRowErr) {
               console.warn('[PokerTable] join_request lookup failed for notif:', reqRowErr);
             }
            if (!reqRow) {
              // already handled elsewhere (auto-approved), do not notify
              return;
            }

            // If the join_request is for a different table, ignore it here
            if (reqRow.table_id && reqRow.table_id !== table.id) {
              return;
            }

             const pid = reqRow.player_id;
             // Check for prior membership: if player has any table_players row for this table,
             // treat as returning player and auto-activate (no admin notification).
             const { data: prior, error: priorErr } = await supabase
               .from('table_players')
               .select('*')
               .eq('table_id', table.id)
               .eq('player_id', pid)
               .maybeSingle();
             if (priorErr) {
               console.warn('[PokerTable] Error checking prior membership:', priorErr);
             }
             if (prior) {
               // Auto-activate returning player and remove join_request (no admin toast)
               try {
                 await supabase
                   .from('table_players')
                   .upsert({ table_id: table.id, player_id: pid, status: 'active' }, { onConflict: 'table_id,player_id' });
               } catch (e) {
                 console.warn('[PokerTable] Failed to upsert table_players for auto-activate:', e);
               }
               try {
                 await supabase.from('join_requests').delete().eq('id', reqId);
               } catch (e) {
                 console.warn('[PokerTable] Failed to delete join_request during auto-approve:', e);
               }
               // refresh local pending and players
               setPendingJoinRequests(prev => prev.filter((r: any) => r.id !== reqId));
               setPendingJoinPlayerIds(prev => {
                 const next = new Set(prev);
                 next.delete(pid);
                 return next;
               });
               await loadPlayersFromJoinTable(table.id);
               return;
             }
            // mark shown (store timestamp)
            shownJoinRequestIdsRef.current.set(reqId, Date.now());
           }

           // fallback: show toast and refresh pending join requests (existing behavior)
           toast('New join request', {
             description: `${payload?.payload?.playerName || 'A player'} requested to join`,
           });

           const { data: reqs, error: reqErr } = await supabase
             .from('join_requests')
             .select('*')
             .eq('table_id', table.id)
             .eq('status', 'pending');
           if (reqErr || !reqs) {
             setPendingJoinRequests([]);
             return;
           }
           const playerIds = Array.from(new Set(reqs.map((r: any) => r.player_id).filter(Boolean)));
           const { data: playersData } = await supabase
             .from('players')
             .select('id,name')
             .in('id', playerIds);
           const nameById: Record<string, string> = {};
           (playersData || []).forEach((p: any) => { nameById[p.id] = p.name; });
           const enriched = reqs.map((r: any) => ({ ...r, player_name: nameById[r.player_id] || undefined }));
           setPendingJoinRequests(enriched);
         } catch (e) {
           console.error('Error handling join_request_created broadcast', e);
         }
       })
       .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
    };
  }, [table?.id, isAdmin, profile?.id]);

  // Ensure real-time updates for total points (buy-ins) for both the current user and all players
  useEffect(() => {
    if (!table) return;

    const buyInsChannel = supabase
      .channel('buy_ins_table_' + table.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'buy_ins',
          filter: `table_id=eq.${table.id}`
        },
        payload => {
          // rely on centralized helper so totals and players are kept in sync
          fetchTotals();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(buyInsChannel);
    };
  }, [table?.id]);

  const handleRequestBuyIn = async () => {
    if (!table || !profile) return;
    const buyInReq = {
      id: uuidv4(),
      table_id: table.id,
      player_id: profile.id,
      amount: parseFloat(amount || '0'),
      status: 'pending'
    };
    const { error } = await supabase.from('buy_in_requests').insert(buyInReq);
    if (error) {
      alert('Failed to request buy-in.');
      return;
    }
    setOpenBuyIn(false);
    setAmount('');
    // REMOVE: alert('Buy-in request submitted. Waiting for admin approval.');
    // No notification shown to the user after submitting buy-in request
  };

  const handleApprove = async (reqId: string) => {
    if (processingRequests.includes(reqId)) return;
    setProcessingRequests(prev => [...prev, reqId]);
    try {
      if (!reqId) return;
      const { data: req, error: fetchErr } = await supabase
        .from('buy_in_requests')
        .select('*')
        .match({ id: reqId })
        .maybeSingle();
      if (fetchErr) {
        console.error('[PokerTable] Error fetching buy_in_request:', fetchErr);
        return;
      }
      if (!req) {
        console.warn('[PokerTable] buy_in_request not found for id', reqId);
        setPendingRequests(prev => prev.filter(r => r.id !== reqId));
        return;
      }

      // Build buy-in row without admin_id (schema doesn't have admin_id)
      const buyInRow = {
        id: uuidv4(),
        table_id: req.table_id,
        player_id: req.player_id,
        amount: req.amount,
        status: 'approved',
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Insert approved buy-in and return minimal fields
      const { data: inserted, error: insertErr } = await supabase
        .from('buy_ins')
        .insert([buyInRow])
        .select('id,player_id,amount')
        .maybeSingle();
      if (insertErr || !inserted) {
        console.error('[PokerTable] Error inserting buy_ins row:', insertErr);
        return;
      }

      // Delete original buy_in_request
      const { error: deleteErr } = await supabase.from('buy_in_requests').delete().eq('id', reqId);
      if (deleteErr) {
        console.error('[PokerTable] Error deleting buy_in_request:', deleteErr);
      }

      // Update local pendingRequests state immediately
      setPendingRequests(prev => prev.filter(r => r.id !== reqId));

      // Update player totals locally
      setPlayerTotals(prev => {
        const next = { ...(prev || {}) };
        const pid = inserted.player_id;
        const amt = Number(inserted.amount || 0);
        next[pid] = (next[pid] || 0) + amt;
        return next;
      });

      // Update players state totalPoints if present
      setPlayers(prev => prev.map(p => p.id === inserted.player_id ? { ...p, totalPoints: (p.totalPoints || 0) + Number(inserted.amount || 0) } : p));
    } finally {
      setProcessingRequests(prev => prev.filter(id => id !== reqId));
    }
  };

  const handleReject = async (reqId: string) => {
    if (processingRequests.includes(reqId)) return;
    setProcessingRequests(prev => [...prev, reqId]);
    try {
      await supabase.from('buy_in_requests').delete().eq('id', reqId);
      setPendingRequests(pendingRequests.filter(r => r.id !== reqId));
    } finally {
      setProcessingRequests(prev => prev.filter(id => id !== reqId));
    }
  };

  const handleApproveJoin = async (reqId: string) => {
    console.log('[PokerTable] handleApproveJoin called for reqId:', reqId);
    
    if (processingJoinRequests.includes(reqId)) return;
    setProcessingJoinRequests(prev => [...prev, reqId]);
    
    try {
      // Guard: ensure reqId is present
      if (!reqId) {
        console.warn('[PokerTable] handleApproveJoin called without reqId');
        return;
      }
      // Use match + maybeSingle to avoid PostgREST negotiation issues (406)
      const { data: req, error } = await supabase
        .from('join_requests')
        .select('*')
        .match({ id: reqId })
        .maybeSingle();
      if (error) {
        console.error('[PokerTable] Error fetching join_request:', error);
        return;
      }
      if (!req) {
        console.warn('[PokerTable] join_request not found for id', reqId);
        return;
      }

      const { data: playerProfile, error: playerError } = await supabase
        .from('players')
        .select('id, name')
        .eq('id', req.player_id)
        .single();
      if (playerError || !playerProfile) return;

      // Check if already in table via table_players (use player_id)
      const { data: existingRows } = await supabase
        .from('table_players')
        .select('*')
        .eq('table_id', table.id)
        .in('player_id', [playerProfile.id]);

      if (existingRows && existingRows.length > 0) {
        // reactivate
        await supabase
          .from('table_players')
          .update({ status: 'active' })
          .eq('table_id', table.id)
          .eq('player_id', playerProfile.id);
      } else {
        // insert new join record in table_players
        await supabase
          .from('table_players')
          .insert({ table_id: table.id, player_id: playerProfile.id, status: 'active' });
      }

      // Remove the join request
      const { error: deleteError } = await supabase.from('join_requests').delete().eq('id', reqId);
      if (deleteError) {
        console.error('[PokerTable] Error deleting join_request:', deleteError);
      } else {
        // Immediately remove from local pending list so UI updates without waiting for realtime fetch
        setPendingJoinRequests(prev => prev.filter((r: any) => r.id !== reqId));
        // Also remove the player id from the pendingJoinPlayerIds set so loadPlayersFromJoinTable will mark them active
        setPendingJoinPlayerIds(prev => {
          const next = new Set(prev);
          next.delete(playerProfile.id);
          return next;
        });
      }
      // reload players from join table (now pendingJoinPlayerIds updated)
      await loadPlayersFromJoinTable(table.id);

      // notify the joining player
      supabase
        .channel('user_' + req.player_id)
        .send({
          type: 'broadcast',
          event: 'join_approved',
          payload: { tableId: table.id }
        });
    } finally {
      setProcessingJoinRequests(prev => prev.filter(id => id !== reqId));
    }
  };

  const handleRejectJoin = async (reqId: string) => {
    if (processingJoinRequests.includes(reqId)) return;
    setProcessingJoinRequests(prev => [...prev, reqId]);
    
    try {
      // Reject: simply remove the join request
      // fetch req to know player_id so we can clear pendingJoinPlayerIds
      const { data: reqRow } = await supabase.from('join_requests').select('player_id').eq('id', reqId).maybeSingle();
      await supabase.from('join_requests').delete().eq('id', reqId);
      setPendingJoinRequests(prev => prev.filter(r => r.id !== reqId));
      if (reqRow?.player_id) {
        setPendingJoinPlayerIds(prev => {
          const next = new Set(prev);
          next.delete(reqRow.player_id);
          return next;
        });
        // reload players so UI updates
        await loadPlayersFromJoinTable(table.id);
      }
    } finally {
      setProcessingJoinRequests(prev => prev.filter(id => id !== reqId));
    }
  };

  // Fetch buy-in history for all players when history dialog is opened
  useEffect(() => {
    if (!table || !openHistory) return;
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('buy_ins')
        .select('player_id, amount, timestamp')
        .eq('table_id', table.id)
        .order('timestamp', { ascending: false });
      if (!error && data) setHistoryData(data);
    };
    fetchHistory();
  }, [table?.id, openHistory]);

  // Fetch end up values from DB when dialog opens (assume table_endups table exists)
  useEffect(() => {
    if (!table || !openEndUp) return;
    const fetchEndUps = async () => {
      const { data, error } = await supabase
        .from('table_endups')
        .select('player_id, endup')
        .eq('table_id', table.id);
      if (!error && data) {
        const values: Record<string, number> = {};
        data.forEach((row: any) => {
          values[row.player_id] = Number(row.endup);
        });
        setEndUpValues(values);
      }
    };
    fetchEndUps();
  }, [table?.id, openEndUp]);

  // Add real-time subscription for table_endups so end up values update live for all users
  useEffect(() => {
    if (!table) return;

    const endUpChannel = supabase
      .channel('table_endups_' + table.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'table_endups',
          filter: `table_id=eq.${table.id}`
        },
        payload => {
          // Refetch end up values when table_endups change
          const fetchEndUps = async () => {
            const { data, error } = await supabase
              .from('table_endups')
              .select('player_id, endup')
              .eq('table_id', table.id);
            if (!error && data) {
              const values: Record<string, number> = {};
              data.forEach((row: any) => {
                values[row.player_id] = Number(row.endup);
              });
              setEndUpValues(values);
            }
          };
          fetchEndUps();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(endUpChannel);
    };
  }, [table]);

  // Handler for admin to update end up value for a player
  const handleEndUpChange = async (playerId: string, value: number) => {
    setEndUpValues((prev) => ({ ...prev, [playerId]: value }));
    // Upsert to table_endups
    await supabase
      .from('table_endups')
      .upsert({ table_id: table.id, player_id: playerId, endup: value });
  };

  // For displaying total points, always use players state
  const totalPoints = Array.isArray(players)
    ? players.reduce((sum, p) => sum + (typeof p.totalPoints === 'number' ? p.totalPoints : 0), 0)
    : 0;

  // Lightweight checksum for playerTotals so we can log changes without deep-compare overhead
  const totalsChecksum = useMemo(() => {
    const keys = Object.keys(playerTotals).sort();
    const sum = keys.reduce((s, k) => s + (Number(playerTotals[k]) || 0), 0);
    return `${keys.length}:${sum}`;
  }, [playerTotals]);

  // Guard: If table is null, do not render PokerTable UI
  if (!table) return null;

  // Debug render-time snapshot — only when key values change
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[PokerTable] Rendering snapshot:', {
        joinCode: table?.join_code ?? table?.joinCode,
        adminName,
        tableName: table?.name,
        playersCount: Array.isArray(players) ? players.length : 0,
        totalsChecksum
      });
    }
  }, [table?.id, adminName, players.length, totalsChecksum]);

  // Handler for exiting the game
   const handleExitGame = async () => {
     if (!table || !profile) return;
     setProcessingExit(true);

     // Mark player as inactive in table_players (use onConflict and fallback to update)
     try {
       const upsertPayload = [{ table_id: table.id, player_id: profile.id, status: 'inactive' }];
       const { error: upsertErr } = await supabase
         .from('table_players')
         .upsert(upsertPayload, { onConflict: 'table_id,player_id' });

       if (upsertErr) {
         console.warn('[PokerTable] table_players upsert error, attempting update:', upsertErr);
         const { error: updateErr } = await supabase
           .from('table_players')
           .update({ status: 'inactive' })
           .match({ table_id: table.id, player_id: profile.id });
         if (updateErr) {
           console.warn('[PokerTable] table_players update also failed (ignored):', updateErr);
         }
       }
     } catch (e) {
       console.warn('[PokerTable] Unexpected error updating table_players (ignored):', e);
     }

     // If the exiting player is admin, do NOT transfer admin role to a random player.
     if (isAdmin) {
       // Do not auto-assign a new admin when the current admin exits.
       // Clear admin_player_id so the table has no admin until someone claims it or rejoins.
       try {
         await supabase
           .from('poker_tables')
           .update({ admin_player_id: null })
           .eq('id', table.id);
       } catch (e) {
         console.warn('[PokerTable] Failed to clear admin_player_id (ignored):', e);
       }
     }
    
    // Refresh players list
    await loadPlayersFromJoinTable(table.id);

    // Clear persisted table immediately so selection shows no active table,
    // then force a full navigation to the selection route to avoid router/state races.
    try { storage.setTable(null); } catch (e) { console.warn('[PokerTable] storage.setTable failed:', e); }
    // Use a hard replace to ensure the app loads the selection page (avoids staying on the same component)
    window.location.replace('/');
    // fallback local cleanup (component will unload on navigation)
    setProcessingExit(false);
    setOpenExit(false);
   };

  return (
    <div className="min-h-screen bg-gradient-page flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl shadow-elegant">
        <CardHeader>
          <CardTitle>
            Poker Table: {table.name || table.joinCode}
          </CardTitle>
          <CardDescription>
            Join Code: {table.join_code || table.joinCode} <br />
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
                          {r.amount >= 0 ? '+' : ''}${r.amount.toFixed(2)}
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