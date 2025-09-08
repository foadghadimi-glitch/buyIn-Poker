import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { storage } from '@/utils/storage';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Player, PokerTable } from '@/integrations/supabase/types';

// Update types to match new simplified schema
type TablePlayer = {
  id: string; // now references players.id
  name: string;
  totalPoints?: number;
  active?: boolean;
  pending?: boolean; // waiting for admin approval
};

type PokerTableRow = PokerTable & {
  players?: TablePlayer[];
  creator?: string;
  total_buy_ins?: number;
  total_end_ups?: number;
  table_players?: any[];
};

interface TableSelectionProps {
  tables: PokerTableRow[];
  onCreateTable: (table: any) => void;
  onJoinTable: (table: any) => void;
  waitingApproval: boolean;
  profile?: any;
  onSwitchPlayer: () => void;
}

const TableSelection = ({
  tables = [],
  onCreateTable,
  onJoinTable,
  waitingApproval,
  profile,
  onSwitchPlayer
}: TableSelectionProps) => {
  const [tableName, setTableName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [openSwitchPlayerDialog, setOpenSwitchPlayerDialog] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    console.log('[TableSelection] waitingApproval changed:', waitingApproval);
  }, [waitingApproval]);

  useEffect(() => {
    console.log('[TableSelection] mounted. waitingApproval:', waitingApproval);
  }, []);

  useEffect(() => {
    console.log('[TableSelection] props.table:', storage.getTable());
    console.log('[TableSelection] props.waitingApproval:', waitingApproval);
  }, [waitingApproval, tableName, joinCode]);

  const handleSwitchPlayer = () => {
    storage.clearAll();
    onSwitchPlayer();
    navigate('/onboarding');
  };

  const joinTable = (tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (table) {
      onJoinTable(table);
    }
  };

  const handleCreate = async () => {
    if (!tableName.trim()) {
      toast.error('Please enter a table name.');
      return;
    }
    setIsCreating(true);
    try {
      let finalTableName = tableName.trim();

      // Check for existing table names in the database
      const { data: existingTables, error } = await supabase
        .from('poker_tables')
        .select('name')
        .ilike('name', `${finalTableName}%`);

      if (!error && existingTables) {
        // Count how many tables have the same base name or base name with _number
        const sameBase = existingTables.filter((t: { name: string }) =>
          t.name === finalTableName || t.name.startsWith(`${finalTableName}_`)
        );
        if (sameBase.length > 0) {
          finalTableName = `${finalTableName}_${sameBase.length}`;
        }
      }

      const tableId = uuidv4();
      const join_code = Math.floor(1000 + Math.random() * 9000);
      const newTable: PokerTable = {
        id: tableId,
        join_code,
        admin_player_id: profile.id, // use admin_player_id
        status: 'active',
        name: finalTableName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error: insertError } = await supabase
        .from('poker_tables')
        .insert(newTable)
        .select('*');
      if (insertError || !data || !data[0]) {
        alert(`Failed to create table. Error: ${insertError.message || 'Unknown error'}`);
        return;
      }

      // insert admin into table_players join table using player_id (not user_id)
      await supabase
        .from('table_players')
        .insert({ table_id: data[0].id, player_id: profile.id, status: 'active' });

      storage.setTable(data[0]);
      // Only call the callback to move to the next page
      if (typeof onCreateTable === 'function') {
        const tableWithPlayers: PokerTableRow = {
          ...data[0],
          players: []
        };
        onCreateTable(tableWithPlayers);
      }
    } catch (error: any) {
      console.error('Error creating table:', error);
      toast.error('Failed to create table.', { description: error.message });
    } finally {
      setIsCreating(false);
    }
  };

  // SIMPLIFIED: only look up table and delegate to parent; no join_request, no admin activation, no broadcast
  const handleJoin = async () => {
    if (!joinCode.trim()) {
      toast.error('Please enter a join code.');
      return;
    }
    setIsJoining(true);
    try {
      const codeInt = parseInt(joinCode, 10);
      if (isNaN(codeInt) || joinCode.length !== 4) {
        toast.error('Enter a valid 4-digit code.');
        return;
      }

      console.log('[TableSelection] Looking up table by join_code', { join_code: codeInt });

      const { data: tableData, error: tableError } = await supabase
        .from('poker_tables')
        .select('*')
        .eq('join_code', codeInt)
        .eq('status', 'active')
        .maybeSingle();

      if (tableError || !tableData) {
        console.warn('[TableSelection] Table lookup failed', { join_code: codeInt, error: tableError?.message });
        toast.error('Join code not found or table inactive.');
        return;
      }

      // Check if user is already a player
      const { data: playerRow, error: playerError } = await supabase
        .from('table_players')
        .select('id, status')
        .eq('table_id', tableData.id)
        .eq('player_id', profile.id)
        .maybeSingle();

      if (playerError) {
        console.error('Error checking player status:', playerError);
        toast.error('Failed to check player status.');
        return;
      }

      if (playerRow) {
        // This is a returning player.
        console.log('[TableSelection] Returning player detected. Reactivating...');
        // Update their status to active.
        await supabase
          .from('table_players')
          .update({ status: 'active' })
          .eq('id', playerRow.id);
        
        // Use onCreateTable to navigate directly to the table.
        toast.info('Rejoining table...');
        onCreateTable(tableData);
        return;
      }

      // This is a new player, create a join request.
      console.log('[TableSelection] New player detected. Creating join request...');
      const { error: requestError } = await supabase.from('join_requests').insert({
        id: uuidv4(),
        table_id: tableData.id,
        player_id: profile.id,
        status: 'pending',
      });

      if (requestError) throw requestError;

      // Notify admin via broadcast
      if (tableData.admin_player_id) {
        await supabase.channel('user_' + tableData.admin_player_id).send({
          type: 'broadcast',
          event: 'join_request_created',
          payload: {
            requestId: uuidv4(), // This is illustrative; the real ID is in the DB
            playerName: profile?.name,
            tableId: tableData.id,
          },
        });
      }

      // Update parent state to show waiting message
      onJoinTable(tableData);

    } catch (error: any) {
      console.error('Error joining table:', error);
      toast.error('Failed to join table.', { description: error.message });
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="bg-gradient-page">
      <div className="container mx-auto p-6">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">
            Select Your Poker Table
          </h1>
          <p className="text-xl text-white/80">
            Choose a table to join or create a new one
          </p>
        </header>

        {tables.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {tables.map((table) => (
              <Card key={table.id} className="bg-gradient-card hover:shadow-elegant transition-shadow cursor-pointer shadow-card" 
                    onClick={() => joinTable(table.id)}>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <span>{table.name}</span>
                    <Badge variant="secondary">
                      {table.table_players ? table.table_players.length : 0} players
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Created by {table.creator}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Total Buy-ins: <span className="font-semibold">${table.total_buy_ins || 0}</span></span>
                    <span>Total End-ups: <span className="font-semibold">${table.total_end_ups || 0}</span></span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="bg-gradient-card shadow-card">
          <CardHeader>
            <CardTitle className="text-2xl text-center">Create New Table</CardTitle>
            <CardDescription className="text-center">
              Start a new poker game with your friends
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Label htmlFor="tableName" className="text-lg font-semibold">Table Name</Label>
              <Input
                id="tableName"
                placeholder="Enter table name"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                className="h-12 text-lg"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              onClick={handleCreate} 
              disabled={!tableName.trim() || isCreating}
              className="w-full btn-poker hero"
            >
              {isCreating ? 'Creating...' : 'Create Table'}
            </Button>
          </CardFooter>
        </Card>

        <div className="mt-8 text-center">
          <Card className="bg-gradient-card shadow-card">
            <CardHeader>
              <CardTitle>Join Existing Table</CardTitle>
              <CardDescription>
                Enter the table code provided by the table creator
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Label htmlFor="joinCode" className="text-lg font-semibold">Table Code</Label>
                <Input
                  id="joinCode"
                  placeholder="Enter 4-digit code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="h-12 text-lg text-center font-mono"
                  maxLength={4}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                onClick={handleJoin} 
                disabled={!joinCode.trim() || isJoining || waitingApproval}
                className="w-full btn-poker secondary"
              >
                {isJoining ? 'Joining...' : 'Join Table'}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {waitingApproval && (
          <div className="mt-8">
            <Card className="bg-yellow-100 border-yellow-300">
              <CardHeader>
                <CardTitle className="text-yellow-800">Waiting for Approval</CardTitle>
                <CardDescription className="text-yellow-700">
                  Your join request has been sent. Please wait for the table admin to approve your request.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}

        <div className="mt-8 text-center">
          <Dialog open={openSwitchPlayerDialog} onOpenChange={setOpenSwitchPlayerDialog}>
            <DialogTrigger asChild>
              <Button variant="ghost" className="text-white/70 hover:text-white">
                Switch Player
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Switch Player</DialogTitle>
                <DialogDescription>
                  This will clear your current session and allow you to create a new player profile.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpenSwitchPlayerDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    setOpenSwitchPlayerDialog(false);
                    handleSwitchPlayer();
                  }}
                >
                  Switch Player
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
};

export default TableSelection;