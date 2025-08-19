import React, { useEffect, useState, useRef } from 'react';
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
  // Log props at top
  console.log('[PokerTable] Rendered with propTable:', propTable);

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

  // Track join-request IDs we've already shown notifications for to avoid duplicates
  // store composite keys "requestId:tableId" to avoid cross-table dupes
  const shownJoinRequestIdsRef = useRef<Set<string>>(new Set());
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

  // Subscribe to table_players changes so we refresh players when rows are inserted/updated/deleted
  useEffect(() => {
    if (!table?.id) return;
    const ch = supabase
      .channel('table_players_' + table.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_players', filter: `table_id=eq.${table.id}` },
        async (payload) => {
          // Always refresh players when table_players changes
          loadPlayersFromJoinTable(table.id);

          try {
            // Defensive enforcement: if the current user was re-activated directly (without a pending join_request),
            // require admin approval instead of leaving them active.
            // Only enforce for the current user's id.
            const newRow = payload?.new;
            const oldRow = payload?.old;
            if (!newRow || !profile?.id) return;
            const newPlayerId = newRow.player_id ?? newRow.user_id;
            if (newPlayerId !== profile.id) return;

            // If row became active (or inserted active) and previously wasn't active, schedule a verification.
            const becameActive = (newRow.status === 'active') && (oldRow?.status !== 'active');
            if (!becameActive) return;

            // Short grace period to allow a legitimate admin-approve flow (which may update table_players and delete join_request)
            setTimeout(async () => {
              try {
                // Re-check: is there any pending join_request for this player & table?
                const { data: pendingReqs } = await supabase
                  .from('join_requests')
                  .select('*')
                  .eq('table_id', table.id)
                  .eq('player_id', profile.id)
                  .eq('status', 'pending');

                // If there is a pending request, do nothing (join flow in progress / awaiting approval)
                if (pendingReqs && pendingReqs.length > 0) return;

                // Also check whether admin may have approved very shortly (we already allowed a grace period),
                // re-query the current table_players row status to confirm it's still 'active'.
                const { data: tpRows } = await supabase
                  .from('table_players')
                  .select('*')
                  .eq('table_id', table.id)
                  .eq('player_id', profile.id);

                const tpRow = Array.isArray(tpRows) && tpRows[0];
                if (!tpRow || tpRow.status !== 'active') return; // nothing to do

                // No pending join_request found and row is active — treat this as a bypass and revert to inactive,
                // then create a join_request so admin must approve.
                console.warn('[PokerTable] Detected activation of current user without pending join_request — reverting and creating join_request.');

                // Attempt to set table_players.status back to 'inactive'
                try {
                  await supabase
                    .from('table_players')
                    .update({ status: 'inactive' })
                    .match({ table_id: table.id, player_id: profile.id });
                } catch (e) {
                  console.warn('[PokerTable] Failed to set table_players to inactive (ignored):', e);
                }

                // Insert a pending join_request if one doesn't already exist (race-safe unique id)
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
                } catch (e) {
                  console.warn('[PokerTable] Failed to insert join_request (ignored):', e);
                }

                // Refresh local pending sets and players
                try {
                  const { data: freshPending } = await supabase
                    .from('join_requests')
                    .select('player_id')
                    .eq('table_id', table.id)
                    .eq('status', 'pending');
                  setPendingJoinPlayerIds(new Set((freshPending || []).map((r: any) => r.player_id).filter(Boolean)));
                } catch (e) { /* ignore */ }
                await loadPlayersFromJoinTable(table.id);

                // Notify user
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
        const statusById: Record<string, string> = {};
        (joinRows || []).forEach((r: any) => {
          const pid = r.user_id ?? r.player_id;
          if (pid) statusById[pid] = r.status;
        });

        const ids = (joinRows || [])
          .map((r: any) => r.user_id ?? r.player_id) // support both column names
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
        const status = statusById[p.id];
        const isInactiveStatus = status === 'inactive';
        const hasPending = pendingJoinPlayerIds.has(p.id); // use component state
        // If DB shows active but there is a pending join_request, treat as pending (ignore active)
        if ((status === 'active' || !status) && hasPending) {
          console.warn('[PokerTable] Ignoring active table_players row for player awaiting approval:', p.id);
        }
        // A player is active only when DB status is not 'inactive' and they are not pending approval.
        const active = !isInactiveStatus && !hasPending;
        return {
          id: p.id,
          name: p.name,
          totalPoints: playerTotals[p.id] ?? 0,
          active,
          pending: hasPending
        };
      });

       setPlayers(newPlayers);
     } catch (e) {
       console.error('loadPlayersFromJoinTable unexpected error (keep previous players):', e);
     }
  };

  // Fetch admin name when table changes
  useEffect(() => {
    const fetchAdminName = async () => {
      if (!table?.admin_player_id) return;
      // use maybeSingle to avoid 406 when admin_player_id doesn't exist in players
      const { data: adminPlayer, error } = await supabase
        .from('players')
        .select('name')
        .eq('id', table.admin_player_id)
        .maybeSingle();
      if (!error && adminPlayer) {
        setAdminName(adminPlayer.name);
      }
    };
    fetchAdminName();
  }, [table?.admin_player_id]);

  // Move isAdmin definition before useEffect
  const isAdmin = profile?.id === table?.admin_player_id;

  // Add real-time subscription for table changes (admin changes, join code, name, etc.)
  useEffect(() => {
    if (!table) return;

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
          console.log('Table updated:', payload);
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
  }, [table]);

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

  // Do not fetch table if propTable is present
  useEffect(() => {
    console.log('[PokerTable] useEffect - table:', table, 'profile:', profile);
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
  }, [profile, table]);

  useEffect(() => {
    // Fetch pending buy-in requests for this table
    const fetchRequests = async () => {
      if (!table) return;
      const { data, error } = await supabase
        .from('buy_in_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      if (!error && data) setPendingRequests(data);
    };
    fetchRequests();
  }, [table, openBuyIn]);

  useEffect(() => {
    // Fetch total approved buy-ins for each player in the table
    const fetchTotals = async () => {
      if (!table) return;
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
    fetchTotals();
  }, [table, pendingRequests]);

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
          // Fetch pending buy-in requests when a new request is added/updated/deleted
          const fetchRequests = async () => {
            const { data, error } = await supabase
              .from('buy_in_requests')
              .select('*')
              .eq('table_id', table.id)
              .eq('status', 'pending');
            if (!error && data) setPendingRequests(data);
          };
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(joinChannel);
      supabase.removeChannel(buyInChannel);
    };
  }, [table, isAdmin]);

  // Listen for broadcast notifications for new join requests (admin only)
  useEffect(() => {
    if (!table || !isAdmin || !profile?.id) return;

    const notifChannel = supabase
      .channel('user_' + profile.id)
      .on('broadcast', { event: 'join_request_created' }, async (payload) => {
        try {
          const reqId = payload?.payload?.requestId;
          const compositeKey = reqId && table?.id ? `${reqId}:${table.id}` : null;
          // If we already showed a notification for this request+table, ignore duplicate
          if (compositeKey && shownJoinRequestIdsRef.current.has(compositeKey)) return;

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
            // mark shown to dedupe further broadcasts for this table
            if (compositeKey) shownJoinRequestIdsRef.current.add(compositeKey);
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
  }, [table, isAdmin, profile?.id]);

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
          const fetchTotals = async () => {
            const { data, error } = await supabase
              .from('buy_ins')
              .select('player_id, amount')
              .eq('table_id', table.id) as any;
            if (!error && data) {
              const totals: Record<string, number> = {};
              (data as Array<{ player_id: string, amount: number }>).forEach((row) => {
                totals[row.player_id] = (totals[row.player_id] || 0) + Number(row.amount);
              });
              setPlayerTotals(totals);
              // Refresh players to include latest totals
              setPlayers(prev => prev.map(p => ({ ...p, totalPoints: totals[p.id] ?? 0 })));
            }
          };
          fetchTotals();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(buyInsChannel);
    };
  }, [table]);

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
  }, [table, openHistory]);

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
  }, [table, openEndUp]);

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

  // Guard: If table is null, navigate away and do not render PokerTable UI
  if (!table) {
    // When table is temporarily null (e.g. storage restored), do not force a redirect here.
    // handleExitGame already performs navigation on explicit exit.
    console.log('[PokerTable] table is null — waiting for app state to resolve.');
    return null;
  }

  // Log values right before rendering (use players)
  console.log('[PokerTable] Rendering table info:', {
    joinCode: table?.joinCode,
    adminName: table?.adminName,
    tableName: table?.name,
    players
  });

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

    // If the exiting player is admin, transfer admin role
    if (isAdmin) {
      const activePlayers = players.filter((p: any) => p.active !== false && p.id !== profile.id);
      if (activePlayers.length > 0) {
        const newAdmin = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        await supabase
          .from('poker_tables')
          .update({ admin_player_id: newAdmin.id, admin_pending_approval: true })
          .eq('id', table.id);

        // notify new admin
        supabase
          .channel('user_' + newAdmin.id)
          .send({
            type: 'broadcast',
            event: 'admin_role_assigned',
            payload: { tableId: table.id }
          });
      } else {
        await supabase
          .from('poker_tables')
          .update({ admin_player_id: null })
          .eq('id', table.id);
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
                <p>
                  You will be moved to the table selection page.
                </p>
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
                    // close dialog immediately and run exit flow (DB work + navigate + clear)
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
  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
    buy_ins
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
    buy_ins
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
    buy_ins
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
    buy_ins
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
  The request for a buy-in that is not approved yet is maintained in the table:
    buy_in_requests

  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
  The approved points information is maintained in the table:
    buy_ins
    buy_ins
*/
