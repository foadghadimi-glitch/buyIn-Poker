import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
};

interface TableSelectionProps {
  table: any;
  onCreateTable: (table: any) => void;
  onJoinTable: (table: any) => void;
  waitingApproval: boolean;
  profile?: any; // ADDED
  onSwitchPlayer: () => void;
}

const TableSelection = ({
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
    storage.setProfile(null);
    storage.setTable(null);
    onSwitchPlayer();
    navigate('/onboarding');
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
    <div
      className="min-h-screen flex flex-col items-center justify-start p-3 pt-8 relative overflow-hidden bg-center bg-cover"
      style={{ backgroundImage: "url('/Poker_05.png')" }}
    >
      {/* Overlay to darken the background image */}
      <div className="absolute inset-0 bg-black/50"></div>

      <div className="space-y-4 w-full max-w-sm relative z-10 flex-shrink-0">
        <Card className="bg-black/50 backdrop-blur-md border border-white/20 text-white shadow-2xl">
          <CardHeader className="p-4">
            <CardTitle className="text-white text-center text-lg">Join a Poker Table</CardTitle>
          </CardHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleJoin(); }}>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="joinCode" className="text-sm font-semibold text-gray-200">Enter Table Code</Label>
                <Input
                  id="joinCode"
                  placeholder="1234"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="h-9 text-base border-2 border-white/30 focus:border-white/50 focus:ring-2 focus:ring-white/30 transition-all duration-200 bg-white/10 text-white placeholder-gray-100 text-center font-mono rounded-lg shadow-inner"
                />
              </div>
            </CardContent>
            <CardFooter className="p-4 pt-0">
              <Button
                type="submit"
                disabled={isJoining || waitingApproval}
                className="w-full h-10 text-sm font-bold bg-[#fbc02d] hover:bg-[#f9a825] active:bg-[#f57f17] text-black transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] rounded-lg"
              >
                {isJoining ? 'Joining...' : 'Join Table'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card className="bg-black/50 backdrop-blur-md border border-white/20 text-white shadow-2xl">
          <CardHeader className="p-4">
            <CardTitle className="text-white text-center text-lg">Create a New Poker Table</CardTitle>
          </CardHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="tableName" className="text-sm font-semibold text-gray-200">Name Your Table</Label>
                <Input
                  id="tableName"
                  placeholder="e.g., Friday Night Poker"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  className="h-9 text-base border-2 border-white/30 focus:border-white/50 focus:ring-2 focus:ring-white/30 transition-all duration-200 bg-white/10 text-white placeholder-gray-100 text-center font-medium rounded-lg shadow-inner"
                />
              </div>
            </CardContent>
            <CardFooter className="p-4 pt-0">
              <Button
                type="submit"
                disabled={isCreating}
                className="w-full h-10 text-sm font-bold bg-[#2e7d32] hover:bg-[#388e3c] active:bg-[#1b5e20] text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] rounded-lg"
              >
                {isCreating ? 'Creating...' : 'Create Table'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* ADDED: Display this card when waiting for approval, instead of navigating away */}
        {waitingApproval && (
          <Card className="bg-yellow-900/30 backdrop-blur-md border border-yellow-400/50 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="text-yellow-300 text-center">Request Sent</CardTitle>
              <CardDescription className="text-yellow-200 text-center">Waiting for admin approval.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center p-4">
                <div className="text-lg font-semibold text-yellow-100">You will be redirected once approved.</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Moved cache clear button here - below the cards with extra spacing */}
        <div className="flex justify-center mt-12 pt-8">
          <Dialog open={openSwitchPlayerDialog} onOpenChange={setOpenSwitchPlayerDialog}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white hover:bg-white/20 text-xs px-3 py-2 border border-white/20 backdrop-blur-sm bg-black/20 rounded-md"
              >
                Clear Cache & Reset Profile
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-900/90 backdrop-blur-md border-white/20 text-white">
              <DialogHeader>
                <DialogTitle>Clear Cache & Reset Profile</DialogTitle>
                <DialogDescription className="text-gray-300 pt-2">
                  This will clear your current player session from this browser. You will be treated as a new player and will need to create a new profile if your original name is already taken.
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
                  Clear & Reset
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