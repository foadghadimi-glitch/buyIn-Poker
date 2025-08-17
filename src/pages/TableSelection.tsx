import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { storage } from '@/utils/storage';
import { v4 as uuidv4 } from 'uuid';

const TableSelection = ({
  onCreateTable,
  onJoinTable,
  waitingApproval
}: {
  onCreateTable: (table?: any) => void;
  onJoinTable: (table?: any) => void;
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
    const newTable = {
      id: tableId,
      join_code,
      admin_user_id: profile.id,
      status: 'active',
      players: [{ id: profile.id, name: profile.name, totalPoints: 0 }],
      name: finalTableName
    };
    const { data, error: insertError } = await supabase
      .from('poker_tables')
      .insert(newTable)
      .select('*');
    if (insertError || !data || !data[0]) {
      alert(`Failed to create table. Error: ${insertError?.message || 'Unknown error'}`);
      return;
    }
    storage.setTable(data[0]);
    // Only call the callback to move to the next page
    if (typeof onCreateTable === 'function') {
      onCreateTable(data[0]);
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

    // Add join request to the database, including player_name
    const joinReq = {
      id: uuidv4(),
      table_id: tableData.id,
      player_id: profile.id,
      player_name: profile.name,
      status: 'pending'
    };
    const { error: joinError } = await supabase.from('join_requests').insert([joinReq]);
    if (joinError) {
      alert('Failed to create join request. ' + (joinError.message || ''));
      return;
    }

    // Just call onJoinTable to trigger waitingApproval UI
    if (typeof onJoinTable === 'function') {
      onJoinTable(tableData);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create or Join a Table</CardTitle>
          <CardDescription>Quickly create a new table or join an existing one</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-4">
              <Label htmlFor="tname">Table name</Label>
              <Input
                id="tname"
                placeholder="Friday Night"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
              />
              <Button className="w-full" variant="hero" onClick={handleCreateTable}>
                Create Table
              </Button>
            </div>
            <div className="space-y-4">
              <Label htmlFor="jcode">Join code</Label>
              <Input
                id="jcode"
                placeholder="1234"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <Button className="w-full" variant="secondary" onClick={handleJoinTable}>
                Join Table
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {waitingApproval && (
        <div className="p-4 text-center text-lg text-yellow-700 bg-yellow-100 rounded">
          Waiting for admin approval...
        </div>
      )}
    </div>
  );
};

export default TableSelection;