import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { storage } from '@/utils/storage';
import { v4 as uuidv4 } from 'uuid';
import { Label } from '@/components/ui/label';
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

const TableSelection = ({
  onCreateTable,
  onJoinTable,
  waitingApproval
}: {
  onCreateTable: (table?: PokerTableRow) => void;
  onJoinTable: (table?: PokerTableRow) => void;
  waitingApproval?: boolean;
}) => {
  const [tableName, setTableName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const profile = storage.getProfile();

  useEffect(() => {
    // Log when waitingApproval changes (i.e., after join request and after admin approval)
    console.log('[TableSelection] waitingApproval changed:', waitingApproval);
  }, [waitingApproval]);

  useEffect(() => {
    // Log when TableSelection is mounted and when props change
    console.log('[TableSelection] mounted. waitingApproval:', waitingApproval);
  }, []);

  // Add logging for props.table and props.waitingApproval on every render
  useEffect(() => {
    console.log('[TableSelection] props.table:', storage.getTable());
    console.log('[TableSelection] props.waitingApproval:', waitingApproval);
  }, [waitingApproval, tableName, joinCode]);

  // Listen for join_approved broadcast event and handle transition
  useEffect(() => {
    const channel = supabase
      .channel('user_' + profile?.id)
      .on('broadcast', { event: 'join_approved' }, payload => {
        // Close the notification if open
        // Move to PokerTable page after notification is closed
        setTimeout(() => {
          if (typeof onJoinTable === 'function') {
            onJoinTable(storage.getTable());
          }
        }, 100); // Small delay to ensure notification is closed
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, onJoinTable]);

  const handleCreateTable = async () => {
    if (!profile) return;
    
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
  };

  const handleJoinTable = async () => {
    if (!profile) return;
    
    const codeInt = parseInt(joinCode, 10);
    if (isNaN(codeInt) || codeInt < 1000 || codeInt > 9999) {
      alert('Please enter a valid 4-digit join code.');
      return;
    }

    // Find the table with the given join_code
    const { data: tableData, error: tableError } = await supabase
      .from('poker_tables')
      .select('*')
      .eq('join_code', codeInt)
      .eq('status', 'active')
      .single();

    if (tableError || !tableData) {
      alert('Join code not found or table is not active.');
      return;
    }

    // Check if this player is the admin
    if (tableData.admin_player_id === profile.id) {
      // mark admin as active in table_players (or upsert)
      await supabase
        .from('table_players')
        .upsert({ table_id: tableData.id, player_id: profile.id, status: 'active' });

      const tableWithPlayers: PokerTableRow = {
        ...tableData,
        players: []
      };
      storage.setTable(tableWithPlayers);
      if (typeof onJoinTable === 'function') onJoinTable(tableWithPlayers);
      return;
    }

    // Check if a pending join request already exists for this user and table
    const { data: existingReqs, error: reqError } = await supabase
      .from('join_requests')
      .select('*')
      .eq('table_id', tableData.id)
      .eq('player_id', profile.id)
      .eq('status', 'pending');

    if (!reqError && existingReqs && existingReqs.length > 0) {
      alert('You already have a pending join request for this table.');
      return;
    }

    // Add join request to the database
    const joinReq = {
      id: uuidv4(),
      table_id: tableData.id,
      player_id: profile.id,
      status: 'pending'
    };
    // Insert and request the inserted row back so we have the join request id
    const { data: insertedReq, error: joinError } = await supabase
      .from('join_requests')
      .insert([joinReq])
      .select('id');
    const insertedId = Array.isArray(insertedReq) && insertedReq[0]?.id ? insertedReq[0].id : joinReq.id;
    if (joinError) {
      alert('Failed to create join request. ' + (joinError.message || ''));
      return;
    }

    // Notify admin using admin_player_id and include the join request id so admin can dedupe
    await supabase
      .channel('user_' + tableData.admin_player_id)
      .send({
        type: 'broadcast',
        event: 'join_request_created',
        payload: { tableId: tableData.id, playerId: profile.id, playerName: profile.name, requestId: insertedId }
      });

    if (typeof onJoinTable === 'function') {
      const tableWithPlayers: PokerTableRow = {
        ...tableData,
        players: []
      };
      onJoinTable(tableWithPlayers);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-page p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="poker-header mb-8">
          <h1 className="text-4xl font-bold mb-2 text-glow">Poker Table Selection</h1>
          <p className="text-xl opacity-90">Create a new table or join an existing one</p>
        </div>

        <div className="poker-layout">
          {/* Create Table Card */}
          <Card className="poker-card shadow-elegant">
            <CardHeader className="text-center">
              <div className="poker-chip mx-auto mb-4">
                <span className="text-xs">NEW</span>
              </div>
              <CardTitle className="text-2xl font-bold text-gray-800">Create New Table</CardTitle>
              <CardDescription className="text-gray-600">Start a new poker session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="tname" className="text-lg font-semibold text-gray-700">Table Name</Label>
                <Input
                  id="tname"
                  placeholder="Friday Night Poker"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  className="h-12 text-lg border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200"
                  onKeyPress={(e) => e.key === 'Enter' && handleCreateTable()}
                />
              </div>
              <Button 
                className="w-full h-14 text-lg font-bold btn-poker success"
                onClick={handleCreateTable}
                disabled={!tableName.trim()}
              >
                🎯 Create Table
              </Button>
            </CardContent>
          </Card>

          {/* Join Table Card */}
          <Card className="poker-card shadow-elegant">
            <CardHeader className="text-center">
              <div className="poker-chip mx-auto mb-4">
                <span className="text-xs">JOIN</span>
              </div>
              <CardTitle className="text-2xl font-bold text-gray-800">Join Existing Table</CardTitle>
              <CardDescription className="text-gray-600">Enter a 4-digit code to join</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="jcode" className="text-lg font-semibold text-gray-700">Join Code</Label>
                <Input
                  id="jcode"
                  placeholder="1234"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="h-12 text-lg border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200 text-center"
                  onKeyPress={(e) => e.key === 'Enter' && handleJoinTable()}
                  maxLength={4}
                />
              </div>
              <Button 
                className="w-full h-14 text-lg font-bold btn-poker primary"
                onClick={handleJoinTable}
                disabled={!joinCode.trim() || joinCode.length !== 4}
              >
                🚀 Join Table
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Waiting for Approval Message */}
        {waitingApproval && (
          <div className="mt-8 text-center">
            <div className="glass-effect rounded-2xl p-6 inline-block">
              <div className="flex items-center justify-center space-x-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                <span className="text-xl text-white font-semibold">Waiting for admin approval...</span>
              </div>
              <p className="text-white opacity-80 mt-2">The table admin will review your request shortly</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="poker-footer mt-12">
          <div className="flex justify-center space-x-4 text-sm opacity-80">
            <span>♠️</span>
            <span>♥️</span>
            <span>♦️</span>
            <span>♣️</span>
            <span>Good luck at the tables!</span>
            <span>♠️</span>
            <span>♥️</span>
            <span>♦️</span>
            <span>♣️</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TableSelection;