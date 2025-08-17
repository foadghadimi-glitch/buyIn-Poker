import { useEffect, useState } from 'react';
import Onboarding from './Onboarding';
import TableSelection from './TableSelection';
import PokerTable from './PokerTable';
import { storage } from '@/utils/storage';
import { supabase } from '@/integrations/supabase/client'; // Ensure this import is present

// Add a visible debug log to the page for troubleshooting
function DebugPanel({ logs }: { logs: string[] }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: '100%',
      maxHeight: '30vh',
      overflowY: 'auto',
      background: 'rgba(0,0,0,0.85)',
      color: 'lime',
      fontSize: '14px',
      zIndex: 99999,
      padding: '12px',
      pointerEvents: 'auto'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Debug Log:</div>
      {logs.map((log, i) => <div key={i} style={{ marginBottom: 2 }}>{log}</div>)}
    </div>
  );
}

const Index = () => {
  const [profile, setProfile] = useState(storage.getProfile());
  const [currentPage, setCurrentPage] = useState<'onboarding' | 'tableSelection' | 'pokerTable'>(
    profile ? 'tableSelection' : 'onboarding'
  );
  const [table, setTable] = useState<any>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Helper to add debug logs
  const addLog = (msg: string, obj?: any) => {
    setDebugLogs(logs => [...logs.slice(-40), msg + (obj ? ' ' + JSON.stringify(obj) : '')]);
  };

  // Real-time subscription for poker_tables updates (for join approval)
  useEffect(() => {
    if (!table || !table.id || !waitingApproval) return;

    // Add debug log to show fetched table players and current user id
    const fetchTable = async () => {
      addLog('[Index] fetchTable called');
      const { data, error } = await supabase
        .from('poker_tables')
        .select('*')
        .eq('id', table.id)
        .single();

      addLog('[Index] Real-time fetchTable triggered. Data:', data);

      if (!error && data) {
        const profile = storage.getProfile();
        addLog('[Index] Checking if user is in players array', { profileId: profile?.id, players: data.players });
        const isPlayer = data.players?.some((p: any) => p.id === profile?.id);

        if (isPlayer) {
          addLog('[Index] User is now in players array. Should move to PokerTable?', { currentPage, waitingApproval });
          if (currentPage === 'tableSelection' && waitingApproval) {
            addLog('[Index] Moving to PokerTable page for player: ' + profile?.id);
            const playersArray = Array.isArray(data.players) ? data.players : [];
            const tableObj = {
              id: data.id,
              name: data.name,
              joinCode: data.join_code,
              adminId: data.admin_user_id,
              status: data.status,
              createdAt: data.created_at,
              updatedAt: data.updated_at,
              players: playersArray,
            };
            storage.setTable(tableObj);
            setTable(tableObj);
            setWaitingApproval(false);
            setCurrentPage('pokerTable');
          }
        } else {
          addLog('[Index] User is NOT in players array. Checking join_requests...', { profileId: profile?.id, players: data.players });
          const { data: joinReqs, error: joinError } = await (supabase as any)
            .from('join_requests')
            .select('*')
            .eq('table_id', table.id)
            .eq('player_id', profile?.id)
            .eq('status', 'pending');
          addLog('[Index] join_requests for user:', joinReqs);
          if (!joinError && joinReqs && joinReqs.length === 0) {
            alert('Your join request was rejected by the admin.');
            setWaitingApproval(false);
            setTable(null);
            setCurrentPage('tableSelection');
          }
        }
      } else {
        addLog('[Index] Error fetching table:', error);
      }
    };

    // --- THIS IS THE REAL-TIME SUBSCRIPTION ---
    // Add a short delay before calling fetchTable to avoid race condition
    const channel = supabase
      .channel('poker_table_player_' + table.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poker_tables',
          filter: `id=eq.${table.id}`
        },
        payload => {
          addLog('[Index] Real-time event received:', payload);
          setTimeout(() => {
            addLog('[Index] Delayed fetchTable after real-time event');
            fetchTable();
          }, 300); // 300ms delay to allow DB update to propagate
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, waitingApproval, currentPage]);

  useEffect(() => {
    document.title = 'Poker Buy-in Tracker';
    console.log('[Index] Current page:', currentPage);
    console.log('[Index] Profile:', profile);
    console.log('[Index] Table:', table);
    // Add debug log for currentPage and waitingApproval
    addLog(`[Index] useEffect: currentPage=${currentPage}, waitingApproval=${waitingApproval}, table.players=${JSON.stringify(table?.players)}`);
  }, [currentPage, profile, table]);

  const handleOnboardingComplete = (profileData: any) => {
    console.log('[Index] Onboarding complete:', profileData);
    storage.setProfile(profileData);
    setProfile(profileData);
    setCurrentPage('tableSelection');
  };

  // Fix: Ensure table is set after join request
  // Add debug log to show which table is being set
  // Add debug log to show when handleTableSelected is called for join requests
  const handleTableSelected = (createdTable?: any, joinPending?: boolean) => {
    console.log('[Index] Table created/selected:', createdTable);
    addLog(`[Index] handleTableSelected called. joinPending=${joinPending}, createdTable=${JSON.stringify(createdTable)}`);
    if (createdTable) {
      storage.setTable(createdTable);
      setTable({ ...createdTable }); // Ensure a new object reference
      addLog(`[Index] setTable called with: ${JSON.stringify(createdTable)}`);
    } else {
      addLog('[Index] setTable called with: null');
      setTable(null); // Explicitly clear table state if no table is selected
    }
    addLog(`[Index] After setTable: table=${JSON.stringify(createdTable)}, waitingApproval=${waitingApproval}, currentPage=${currentPage}`);
    if (joinPending) {
      addLog('[Index] Setting waitingApproval=true and currentPage=tableSelection for join request');
      setWaitingApproval(true);
      setCurrentPage('tableSelection');
    } else {
      setWaitingApproval(false);
      setCurrentPage('pokerTable');
    }
  };

  // Fix: Ensure onboarding is shown if profile is missing
  useEffect(() => {
    if (!profile) {
      setCurrentPage('onboarding');
    }
  }, [profile]);

  // Fix: If profile exists and table.players includes the user, move to PokerTable
  useEffect(() => {
    if (
      profile &&
      table &&
      Array.isArray(table.players) &&
      table.players.some((p: any) => p.id === profile.id)
    ) {
      setCurrentPage('pokerTable');
    }
  }, [profile, table]);

  // Fix: Only auto-transition to PokerTable if the current user is NOT the admin
  useEffect(() => {
    if (
      profile &&
      table &&
      Array.isArray(table.players) &&
      table.players.some((p: any) => p.id === profile.id) &&
      table.adminId !== profile.id // Only transition for non-admin users
    ) {
      setCurrentPage('pokerTable');
    }
  }, [profile, table]);

  // Restore session from local storage on initial load
  useEffect(() => {
    const storedProfile = storage.getProfile();
    const storedTable = storage.getTable();
    if (storedProfile) {
      setProfile(storedProfile);
      if (storedTable && storedTable.id) {
        // Fetch latest table data from Supabase
        supabase
          .from('poker_tables')
          .select('*')
          .eq('id', storedTable.id)
          .single()
          .then(({ data, error }) => {
            if (!error && data) {
              const playersArray = Array.isArray(data.players) ? data.players : [];
              const tableObj = {
                id: data.id,
                name: data.name,
                joinCode: data.join_code,
                adminId: data.admin_user_id,
                status: data.status,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                players: playersArray,
              };
              storage.setTable(tableObj);
              setTable(tableObj);
              // If user is a player, go to PokerTable
              if (playersArray.some((p: any) => p.id === storedProfile.id)) {
                setCurrentPage('pokerTable');
              } else {
                setCurrentPage('tableSelection');
              }
            } else {
              // Table not found, fallback to table selection
              setTable(null);
              setCurrentPage('tableSelection');
            }
          });
      } else {
        setCurrentPage('tableSelection');
      }
    } else {
      setCurrentPage('onboarding');
    }
  }, []);

  if (currentPage === 'onboarding') {
    console.log('[Index] Rendering Onboarding');
    return <Onboarding onSetProfile={handleOnboardingComplete} />;
  }

  // Add debug log to TableSelection render to show table state and waitingApproval
  if (currentPage === 'tableSelection') {
    console.log('[Index] Rendering TableSelection');
    return (
      <TableSelection
        onCreateTable={(table) => handleTableSelected(table, false)}
        onJoinTable={(table) => handleTableSelected(table, true)}
        waitingApproval={waitingApproval}
      />
    );
  }

  if (currentPage === 'pokerTable') {
    console.log('[Index] Rendering PokerTable with table:', table);
    if (!table) {
      const storedTable = storage.getTable();
      console.log('[Index] No table in state, checking storage:', storedTable);
      if (storedTable) setTable(storedTable);
      else return <div className="min-h-screen flex items-center justify-center">No Table Found</div>;
    }
    return <PokerTable table={table} />;
  }

  return (
    <>
      {/* ...existing code for page rendering... */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        maxHeight: '30vh',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.85)',
        color: 'lime',
        fontSize: '14px',
        zIndex: 99999,
        padding: '12px',
        pointerEvents: 'auto'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Debug Log:</div>
        {debugLogs.map((log, i) => <div key={i} style={{ marginBottom: 2 }}>{log}</div>)}
      </div>
      <img src="/poker-logo.png" alt="Poker Logo" width={64} height={64} />
    </>
  );
};

// Clarification:
// The variable `table` in your code refers to a row/object from the Supabase table named "poker_tables" in your database.
// It is not a table named "table" in your database.
// The database table is "poker_tables", and each "table" variable in your code is a single game/table instance (row) from "poker_tables".

export default Index;

// Analysis of your logs and behavior:

// - When you first send a join request as a user, the page does not update after admin approval.
// - After clearing cache/storage and creating a new user, the join request and approval work as expected.

// **What this means:**
// - The issue is likely caused by stale or incorrect data in localStorage/sessionStorage (used by your storage utility).
// - If the user's profile or table info in storage is out of sync with the database, the real-time logic may not run or may use the wrong table/profile.
// - When you clear the cache/storage and start fresh, the state is correct and everything works.

// **How to fix/prevent:**
// - Always update local storage (profile and table) immediately after onboarding and after join request/approval.
// - Make sure your storage utility does not return stale/null data.
// - Consider adding a check to reload profile/table from the database if storage returns null or outdated data.
// - Add logging to your storage utility to debug what is being set and retrieved.

// **Summary:**
// - The root cause is stale or missing data in local storage.
// - Clearing cache/storage resets the state and fixes the issue.
// - Ensure your storage logic is robust and always in sync with the latest user and table data.

// Analysis:

// - The admin page logs show that after approval, the table's players array is updated correctly (shows 2 players).
// - The joining player's page does NOT update to PokerTable immediately after approval; it stays on TableSelection.
// - The debug logs show that the joining player's ID is NOT present in the table's players array when their client fetches the table after approval, but the admin's client sees the correct array.

// **Possible causes:**
// 1. **Race condition or delay:** The joining player's client may be fetching the table before the database update is fully committed or before the real-time event is triggered.
// 2. **Local state not refreshed:** The joining player's client may not be refreshing its table state after the real-time event, or the table state is stale.
// 3. **Multiple fetches:** The logs show multiple renders and fetches; ensure only one fetchTable runs per real-time event.

// **What to check/fix:**
// - Make sure the joining player's client waits for the real-time event and only transitions to PokerTable when their ID is present in the table's players array.
// - Add a log in the real-time event handler to show the fetched table's players array and the current user's ID.
// - If the table is not updated, add a short delay (setTimeout) before calling fetchTable to allow the database update to propagate.
// - Ensure the table state is always updated with the latest data from Supabase, not from local storage.

// **Summary:**
// - The admin logic is correct and the database is updated.
// - The joining player's client may be fetching stale data or fetching too soon.
// - Add logging and possibly a short delay in the real-time event handler for the joining player's client to ensure the table update is detected.

// To update the database accordingly (so the joining player's ID is added to the table's players array):
// This must be done in the admin approval logic, typically in PokerTable.tsx, handleApproveJoin:

// Example (already in your PokerTable.tsx):
// When the admin approves a join request:
//await supabase
//  .from('poker_tables')
//  .update({ players: updatedPlayers }) // updatedPlayers includes the new joining player
//  .eq('id', table.id);

// This ensures the database row for the table is updated with the new players array.
// The real-time subscription in Index.tsx will then detect the change and update the joining user's page.