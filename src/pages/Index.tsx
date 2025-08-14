import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { storage, uid, fourDigitCode } from '@/utils/storage';
import type { BuyInRequest, Player, Table as PokerTable } from '@/types';
import { supabase } from '@/integrations/supabase/client';

const Index = () => {
  const navigate = useNavigate();
  const profile = storage.getProfile();
  const [table, setTable] = useState<PokerTable | null>(storage.getTable());
  useEffect(() => {
    document.title = 'Poker Buy-in Tracker — Home';
    if (!profile) navigate('/onboarding');
  }, []);

  useEffect(() => {
    if (table) storage.setTable(table);
  }, [table]);

  const isAdmin = useMemo(() => {
    if (!profile || !table) return false;
    return table.adminId === profile.id;
  }, [profile, table]);

  if (!profile) return null;

  const createTable = async (name?: string) => {
    const join = fourDigitCode();
    const admin: Player = {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      totalBuyIns: 0,
    };
    const newTable: PokerTable = {
      id: uid('t_'),
      name,
      joinCode: join,
      adminId: profile.id,
      players: [admin],
      requests: [],
      status: 'active',
    };
    setTable(newTable);

    // Save to Supabase
    const { data, error } = await supabase.from('poker_tables').insert({
      admin_user_id: null,
      name: name ?? null,
      join_code: join,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Failed to create table in DB', error);
      return;
    }

    // Save admin player to Supabase
    await supabase.from('table_players').insert({
      table_id: data.id,
      name: admin.name,
      avatar_url: admin.avatar,
      total_buy_ins: 0,
    });
  };

  const joinTable = async (code: string) => {
    // First check local storage
    const localTable = storage.getTable();
    if (localTable?.joinCode === code) {
      if (!localTable.players.find((p) => p.id === profile.id)) {
        localTable.players.push({ id: profile.id, name: profile.name, avatar: profile.avatar, totalBuyIns: 0 });
        setTable({ ...localTable });
      }
      return;
    }

    // Search Supabase for table with join code
    const { data: tableData, error: tableError } = await supabase
      .from('poker_tables')
      .select('*')
      .eq('join_code', code)
      .eq('status', 'active')
      .single();

    if (tableError || !tableData) {
      alert('Join code not found or table is not active.');
      return;
    }

    // Get existing players for this table
    const { data: playersData, error: playersError } = await supabase
      .from('table_players')
      .select('*')
      .eq('table_id', tableData.id);

    if (playersError) {
      console.error('Failed to fetch players:', playersError);
      return;
    }

    // Convert to our local format
    const players: Player[] = playersData.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar_url,
      totalBuyIns: parseFloat(String(p.total_buy_ins)),
      finalAmount: p.final_amount ? parseFloat(String(p.final_amount)) : undefined,
    }));

    // Check if user already joined
    const alreadyJoined = players.find(p => p.name === profile.name);
    if (!alreadyJoined) {
      // Add current user to table
      const { data: newPlayer, error: playerError } = await supabase
        .from('table_players')
        .insert({
          table_id: tableData.id,
          name: profile.name,
          avatar_url: profile.avatar,
          total_buy_ins: 0,
        })
        .select()
        .single();

      if (playerError) {
        console.error('Failed to add player:', playerError);
        return;
      }

      players.push({
        id: newPlayer.id,
        name: newPlayer.name,
        avatar: newPlayer.avatar_url,
        totalBuyIns: 0,
      });
    }

    // Create local table object
    const joinedTable: PokerTable = {
      id: tableData.id,
      name: tableData.name || undefined,
      joinCode: tableData.join_code,
      adminId: tableData.admin_user_id || players[0]?.id || profile.id,
      players,
      requests: [],
      status: tableData.status as any,
    };

    setTable(joinedTable);
  };

  const requestBuyIn = (amount: number) => {
    if (!table || !profile) return;
    const req: BuyInRequest = {
      id: uid('r_'),
      playerId: profile.id,
      amount,
      status: 'pending',
    };
    setTable({ ...table, requests: [req, ...table.requests] });
  };

  const approve = (id: string) => {
    if (!table) return;
    const r = table.requests.find((x) => x.id === id);
    if (!r) return;
    const players = table.players.map((p) =>
      p.id === r.playerId ? { ...p, totalBuyIns: p.totalBuyIns + r.amount } : p
    );
    const requests = table.requests.filter((x) => x.id !== id);
    setTable({ ...table, players, requests });
  };

  const reject = (id: string) => {
    if (!table) return;
    setTable({ ...table, requests: table.requests.filter((x) => x.id !== id) });
  };

  const endGame = (finals: Record<string, number>) => {
    if (!table) return;
    const players = table.players.map((p) => ({ ...p, finalAmount: finals[p.id] ?? p.finalAmount ?? 0 }));
    setTable({ ...table, players, status: 'ended' });
  };

  const reset = () => {
    storage.clearTable();
    setTable(null);
  };

  return (
    <div className="min-h-screen bg-gradient-page">
      <div className="container py-10 space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Poker Table Buy-in Tracker</h1>
          <Button variant="outline" onClick={() => navigate('/onboarding')}>Edit Profile</Button>
        </header>

        {!table ? (
          <Landing createTable={createTable} joinTable={joinTable} />
        ) : table.status === 'active' ? (
          <ActiveTable
            table={table}
            profileId={profile.id}
            isAdmin={isAdmin}
            onRequest={requestBuyIn}
            onApprove={approve}
            onReject={reject}
            onEnd={endGame}
            onReset={reset}
          />
        ) : (
          <Results table={table} onReset={reset} />
        )}
      </div>
    </div>
  );
};

const Landing = ({ createTable, joinTable }: { createTable: (name?: string) => void; joinTable: (code: string) => void }) => {
  const [openCreate, setOpenCreate] = useState(false);
  const [openJoin, setOpenJoin] = useState(false);
  const [tableName, setTableName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>Create Table</CardTitle>
          <CardDescription>Be the admin and share a 4-digit join code</CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button variant="hero">Create Table</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Table</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Label htmlFor="tname">Table name (optional)</Label>
                <Input id="tname" placeholder="Friday Night" value={tableName} onChange={(e) => setTableName(e.target.value)} />
              </div>
              <DialogFooter>
                <Button onClick={() => { createTable(tableName || undefined); setOpenCreate(false); }}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>Join Table</CardTitle>
          <CardDescription>Enter the 4-digit code from your admin</CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={openJoin} onOpenChange={setOpenJoin}>
            <DialogTrigger asChild>
              <Button variant="secondary">Join Table</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join with Code</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Label htmlFor="jcode">Join code</Label>
                <Input id="jcode" placeholder="1234" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
              </div>
              <DialogFooter>
                <Button onClick={() => { joinTable(joinCode.trim()); setOpenJoin(false); }}>Join</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
};

const ActiveTable = ({ table, profileId, isAdmin, onRequest, onApprove, onReject, onEnd, onReset }: {
  table: PokerTable;
  profileId: string;
  isAdmin: boolean;
  onRequest: (amount: number) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEnd: (finals: Record<string, number>) => void;
  onReset: () => void;
}) => {
  const navigate = useNavigate();
  const [openBuyIn, setOpenBuyIn] = useState(false);
  const [amount, setAmount] = useState('50');
  const [openEnd, setOpenEnd] = useState(false);
  const [finals, setFinals] = useState<Record<string, string>>({});

  const pending = table.requests;
  
  // Calculate totals for end game validation
  const totalBuyIns = table.players.reduce((sum, p) => sum + p.totalBuyIns, 0);

  return (
    <div className="space-y-8">
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>Table {table.name ? `— ${table.name}` : ''}</CardTitle>
          <CardDescription>Join code: {table.joinCode}</CardDescription>
        </CardHeader>
        <CardContent>
          <UITable>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Total Buy-ins</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.players.map((p) => (
                <TableRow key={p.id} className={p.id === profileId ? 'bg-accent/10' : ''}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-right">${p.totalBuyIns.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </UITable>

          <div className="mt-6 flex flex-wrap gap-3">
            <Dialog open={openBuyIn} onOpenChange={setOpenBuyIn}>
              <DialogTrigger asChild>
                <Button variant="hero">Request Buy-in</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request Buy-in</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount (can be negative)</Label>
                  <Input id="amount" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button onClick={() => { onRequest(parseFloat(amount || '0')); setOpenBuyIn(false); }}>Submit</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button variant="secondary" onClick={() => navigate('/history')}>
              History
            </Button>

            {isAdmin && (
              <>
                <Dialog open={openEnd} onOpenChange={setOpenEnd}>
                  <DialogTrigger asChild>
                    <Button variant="destructive">End Game</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>End Game - Final Amounts</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <UITable>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Player</TableHead>
                            <TableHead className="text-right">Total Buy-ins</TableHead>
                            <TableHead className="text-right">Final Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {table.players.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>{p.name}</TableCell>
                              <TableCell className="text-right">${p.totalBuyIns.toFixed(2)}</TableCell>
                              <TableCell>
                                <Input 
                                  type="number" 
                                  inputMode="decimal" 
                                  value={finals[p.id] ?? ''} 
                                  onChange={(e) => setFinals({ ...finals, [p.id]: e.target.value })}
                                  className="text-right"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-bold">
                            <TableCell>TOTALS</TableCell>
                            <TableCell className="text-right">${totalBuyIns.toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                              ${Object.entries(finals).reduce((sum, [_, v]) => sum + parseFloat(v || '0'), 0).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </UITable>
                      <p className="text-sm text-muted-foreground">
                        Note: Total buy-ins should equal total final amounts for a balanced game.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => {
                        const parsed: Record<string, number> = {};
                        Object.entries(finals).forEach(([k, v]) => parsed[k] = parseFloat(v || '0'));
                        onEnd(parsed);
                        setOpenEnd(false);
                      }}>Save & Calculate</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" onClick={onReset}>Reset Table</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {isAdmin && pending.length > 0 && (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>Pending Approvals</CardTitle>
            <CardDescription>Approve or reject buy-in requests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pending.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="font-medium">{table.players.find((p) => p.id === r.playerId)?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {r.amount >= 0 ? '+' : ''}${r.amount.toFixed(2)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onApprove(r.id)}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => onReject(r.id)}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>All Players</CardTitle>
          <CardDescription>Current players and their total buy-ins</CardDescription>
        </CardHeader>
        <CardContent>
          <UITable>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Total Buy-ins</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.players.map((p) => (
                <TableRow key={p.id} className={p.id === profileId ? 'bg-accent/10' : ''}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-right">${p.totalBuyIns.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </UITable>
        </CardContent>
      </Card>
    </div>
  );
};

const Results = ({ table, onReset }: { table: PokerTable; onReset: () => void }) => {
  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle>Final Results</CardTitle>
        <CardDescription>Profit/Loss = Final Amount - Total Buy-ins</CardDescription>
      </CardHeader>
      <CardContent>
        <UITable>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead className="text-right">Total Buy-ins</TableHead>
              <TableHead className="text-right">Final Amount</TableHead>
              <TableHead className="text-right">Profit/Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.players.map((p) => {
              const final = p.finalAmount ?? 0;
              const pnl = final - p.totalBuyIns;
              return (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-right">${p.totalBuyIns.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${final.toFixed(2)}</TableCell>
                  <TableCell className={`text-right ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </UITable>
        <div className="mt-6 flex gap-3">
          <Button onClick={onReset}>Reset Table</Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default Index;
