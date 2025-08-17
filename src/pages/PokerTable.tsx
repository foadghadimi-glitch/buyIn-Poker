import React, { useEffect, useState } from 'react';
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

// Define the type for a player
type TablePlayer = {
  id: string;
  name: string;
  totalPoints?: number;
};

// Extend the poker_tables row type to include 'players'
type PokerTableRow = {
  admin_user_id?: string;
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
  const [openBuyIn, setOpenBuyIn] = useState(false);
  const [openHistory, setOpenHistory] = useState(false); // Add state for history dialog
  const [openEndUp, setOpenEndUp] = useState(false); // Add state for end up dialog
  const [amount, setAmount] = useState('');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [playerTotals, setPlayerTotals] = useState<Record<string, number>>({});
  const [pendingJoinRequests, setPendingJoinRequests] = useState<any[]>([]);
  const [historyData, setHistoryData] = useState<any[]>([]); // Store buy-in history
  const [endUpValues, setEndUpValues] = useState<Record<string, number>>({}); // Store end up values per player
  const [processingRequests, setProcessingRequests] = useState<string[]>([]);

  // Move isAdmin definition before useEffect
  const isAdmin = profile?.id === table?.adminId || profile?.id === table?.admin_user_id;

  // Do not fetch table if propTable is present
  useEffect(() => {
    console.log('[PokerTable] useEffect - table:', table, 'profile:', profile);
    if (!table && profile) {
      // Fetch the current table for the user
      const fetchTable = async () => {
        // Try to get the table from local storage first
        const localTable = storage.getTable();
        if (localTable) {
          setTable(localTable);
          return;
        }
        // Fallback: Find the table where the user is in the players array
        const { data, error } = await supabase
          .from('poker_tables')
          .select('*')
          .contains('players', [{ id: profile.id }])
          .single();
        if (!error && data) setTable(data);
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
      }
    };
    fetchTotals();
  }, [table, pendingRequests]);

  // Fetch pending join requests for this table (for admin)
  useEffect(() => {
    if (!table || !isAdmin) return;

    // Initial fetch
    const fetchJoinRequests = async () => {
      // @ts-expect-error: join_requests table is not in generated types
      // @ts-expect-error: join_requests table is not in generated types
      const { data, error } = await (supabase as any)
        .from('join_requests')
        .select('*')
        .eq('table_id', table.id)
        .eq('status', 'pending');
      if (!error && data) setPendingJoinRequests(data);
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
          // Refetch totals when buy_ins change
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
              // Update table.players totalPoints for real-time table below
              setTable((prev: any) => ({
                ...prev,
                players: prev.players.map((p: any) => ({
                  ...p,
                  totalPoints: totals[p.id] || 0
                }))
              }));
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
      const { data: req, error } = await supabase.from('buy_in_requests').select('*').eq('id', reqId).single();
      if (error || !req) return;

      // Ensure buy-in is added to buy_ins table with all required fields
      await supabase.from('buy_ins').insert({
        id: uuidv4(),
        table_id: req.table_id,
        player_id: req.player_id,
        admin_id: profile.id, // admin who approved
        amount: req.amount,
        status: 'approved',
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // Remove the request from buy_in_requests
      await supabase.from('buy_in_requests').delete().eq('id', reqId);
      setPendingRequests(pendingRequests.filter(r => r.id !== reqId));
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

    // Find the join request
    const { data: req, error } = await supabase
      .from('join_requests')
      .select('*')
      .eq('id', reqId)
      .single();
    console.log('[PokerTable] join_request fetched:', req, 'error:', error);
    if (error || !req) return;

    // Fetch the joining user's profile for correct name
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', req.player_id)
      .single();
    console.log('[PokerTable] userProfile fetched:', userProfile, 'error:', userError);
    if (userError || !userProfile) return;

    // Check if player is already in the table (avoid duplicates)
    const alreadyInTable = table.players.some((p: any) => p.id === userProfile.id);
    console.log('[PokerTable] alreadyInTable:', alreadyInTable, 'table.players:', table.players);

    if (alreadyInTable) {
      // Remove the join request, but do not add again
      await supabase.from('join_requests').delete().eq('id', reqId);
      setPendingJoinRequests(pendingJoinRequests.filter(r => r.id !== reqId));
      console.log('[PokerTable] Player already in table, join request deleted.');
      return;
    }

    // --- Add the joining player to the table's players array ---
    const updatedPlayers = [
      ...table.players,
      { id: userProfile.id, name: userProfile.name, totalPoints: 0 }
    ];
    console.log('[PokerTable] Updating poker_tables row with new players array:', updatedPlayers);

    const { error: updateError } = await supabase
      .from('poker_tables')
      .update({ players: updatedPlayers })
      .eq('id', table.id);

    if (updateError) {
      console.error('[PokerTable] Error updating poker_tables row:', updateError);
    } else {
      console.log('[PokerTable] poker_tables row updated successfully.');
    }

    // Remove the join request
    const { error: deleteError } = await supabase.from('join_requests').delete().eq('id', reqId);
    if (deleteError) {
      console.error('[PokerTable] Error deleting join_request:', deleteError);
    } else {
      console.log('[PokerTable] join_request deleted successfully.');
    }
    setPendingJoinRequests(pendingJoinRequests.filter(r => r.id !== reqId));

    // Refresh table state
    setTable({ ...table, players: updatedPlayers });
    console.log('[PokerTable] setTable called with updated players:', updatedPlayers);

    // --- Notify the joining player (client) ---
    // Find the device ID of the joining player (assuming it's stored in the players array)
    const playerDeviceId = storage.getDeviceId(userProfile.id);
    console.log('[PokerTable] Fetched device ID for player:', playerDeviceId);

    if (playerDeviceId) {
      // Send a real-time notification to the joining player
      supabase
        .channel('table_' + table.id)
        .send({
          type: 'broadcast',
          event: 'player_joined',
          payload: { tableId: table.id, playerId: userProfile.id }
        });
      console.log('[PokerTable] Real-time notification sent to joining player:', userProfile.id);
    } else {
      console.warn('[PokerTable] Device ID not found for player:', userProfile.id);
    }

    // After successful approval and table update:
    // Send a broadcast event to notify the joining user
    const { data: reqData } = await supabase
      .from('join_requests')
      .select('*')
      .eq('id', reqId)
      .single();

    if (reqData && reqData.player_id) {
      supabase
        .channel('user_' + reqData.player_id)
        .send({
          type: 'broadcast',
          event: 'join_approved',
          payload: { tableId: table.id }
        });
    }
  };

  const handleRejectJoin = async (reqId: string) => {
    // Reject: simply remove the join request
    await supabase.from('join_requests').delete().eq('id', reqId);
    setPendingJoinRequests(pendingJoinRequests.filter(r => r.id !== reqId));
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

  // For displaying total points, always use table.players from props
  const totalPoints = Array.isArray(table.players)
    ? table.players.reduce((sum, p) => sum + (typeof p.points === 'number' ? p.points : 0), 0)
    : 0;

  if (!table) {
    console.log('[PokerTable] No table found, rendering fallback');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-page">
        <div>No Table Found</div>
      </div>
    );
  }

  // Log values right before rendering
  console.log('[PokerTable] Rendering table info:', {
    joinCode: table?.joinCode,
    adminName: table?.adminName,
    tableName: table?.name,
    players: table?.players,
  });

  return (
    <div className="min-h-screen bg-gradient-page flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl shadow-elegant">
        <CardHeader>
          <CardTitle>
            Poker Table: {table.name || table.joinCode}
          </CardTitle>
          <CardDescription>
            Join Code: {table.joinCode} <br />
            Admin: {table.adminName || 'Unknown'}
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
                          const playerBuyIns = table.players.map((p: any) =>
                            historyData.filter((row: any) => row.player_id === p.id)
                          );
                          const maxBuyIns = Math.max(...playerBuyIns.map(arr => arr.length), 0);
                          return Array.from({ length: maxBuyIns }).map((_, idx) => (
                            <TableHead key={idx} style={{ minWidth: 40, padding: '2px 4px', textAlign: 'center' }}>
                              {idx + 1}
                            </TableHead>
                          ));
                        })()}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {table.players.map((p: any) => {
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
                              const playerBuyIns = table.players.map((pl: any) =>
                                historyData.filter((row: any) => row.player_id === pl.id)
                              );
                              const maxBuyIns = Math.max(...playerBuyIns.map(arr => arr.length), 0);
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
                        {Array.isArray(table.players) && table.players.map((p: any) => (
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
                          {table.players.find((p: any) => p.id === r.player_id)?.name || r.player_id}
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
                    const playerObj = table.players.find((p: any) => p.id === r.player_id);
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
                          <Button size="sm" onClick={() => handleApproveJoin(r.id)}>Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => handleRejectJoin(r.id)}>Reject</Button>
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
              {table.players.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-right">
                    {parseInt(String(p.totalPoints ?? 0), 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </UITable>
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
*/
