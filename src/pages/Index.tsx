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

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      setError(event.error || new Error(event.message));
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  if (error) {
    return (
      <div style={{
        background: 'red',
        color: 'white',
        padding: 16,
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        zIndex: 100000,
      }}>
        <strong>App Error:</strong> {error.message}
        <pre>{error.stack}</pre>
      </div>
    );
  }
  return <>{children}</>;
}

const Index = () => {
  const [profile, setProfile] = useState(storage.getProfile());
  const [currentPage, setCurrentPage] = useState<'onboarding' | 'tableSelection' | 'pokerTable'>(
    profile ? 'tableSelection' : 'onboarding'
  );
  const [table, setTable] = useState<any>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [isRefresh, setIsRefresh] = useState(true);

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
      const { data, error } = await (supabase as any)
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
              joinCode: (data as any).join_code,
              adminId: (data as any).admin_user_id,
              status: (data as any).status,
              createdAt: (data as any).created_at,
              updatedAt: (data as any).updated_at,
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

  // Onboarding complete: ensure profile exists in Supabase
  const handleOnboardingComplete = async (profileData: any) => {
    console.log('[Index] Onboarding complete:', profileData);
    // Check if profile exists in Supabase
    const { data: existingProfile, error } = await supabase
      .from('users')
      .select('id')
      .eq('id', profileData.id)
      .maybeSingle();

    if (!existingProfile && !error) {
      // Insert profile if not exists
      await supabase.from('users').insert([profileData]);
    }
    storage.setProfile(profileData);
    setProfile(profileData);
    setCurrentPage('tableSelection');
    setIsRefresh(false); // <-- Always set to false after onboarding
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
      setIsRefresh(true); // <-- FIX: Set to true to trigger refresh logic after table creation
    } else {
      addLog('[Index] setTable called with: null');
      setTable(null);
      storage.setTable(null);
      setIsRefresh(false);
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

    // Use local storage for initial state
    if (storedProfile) {
      setProfile(storedProfile);
      if (storedTable && storedTable.id) {
        setTable(storedTable);
        // Decide initial page based on local storage
        if (storedProfile.id === storedTable.adminId) {
          setCurrentPage('pokerTable');
        } else if (
          Array.isArray(storedTable.players) &&
          storedTable.players.some((p: any) => p.id === storedProfile.id)
        ) {
          setCurrentPage('pokerTable');
        } else {
          setCurrentPage('tableSelection');
        }
      } else {
        setCurrentPage('tableSelection');
      }
    } else {
      setCurrentPage('onboarding');
    }
    // <-- Only set isRefresh=true here, not in handleTableSelected
    setIsRefresh(true); // Mark as refresh ONLY on initial load/restore

    // Fetch latest profile and table from Supabase in background
    if (storedProfile) {
      supabase
        .from('users')
        .select('*')
        .eq('id', storedProfile.id)
        .maybeSingle()
        .then(({ data: profileData, error: profileError }) => {
          if (!profileError && profileData) {
            storage.setProfile(profileData);
            setProfile(profileData);
          } else {
            addLog(`[Index] Warning: Profile not found for id ${storedProfile.id}, keeping local profile.`);
            // Do NOT overwrite local profile if fetch fails
          }
        });

      if (storedTable && storedTable.id) {
        supabase
          .from('poker_tables')
          .select('*')
          .eq('id', storedTable.id)
          .single()
          .then(async ({ data, error }) => {
            if (!error && data) {
              const playersArray = Array.isArray(data.players) ? data.players : [];
              // Note: Points will be merged in the refresh effect using buy_ins
              let mergedPlayers = playersArray;
              
              const tableObj = {
                id: data.id,
                name: data.name,
                joinCode: data.join_code,
                adminId: data.admin_user_id,
                status: data.status,
                createdAt: (data as any).created_at,
                updatedAt: (data as any).updated_at,
                players: mergedPlayers,
              };
              // Log before saving to storage:
              console.log('[Index] Saving tableObj to storage:', tableObj);
              storage.setTable(tableObj);
              setTable(tableObj);
              // Optionally update currentPage if needed
            } else {
              addLog('[Index] Error fetching table on initial load:', error);
            }
          });
      }
    }
  }, []);

  // Ensure latest player points, admin name, and join code are fetched and merged after refresh
  useEffect(() => {
    if (
      isRefresh &&
      table &&
      Array.isArray(table.players) &&
      table.players.length > 0
    ) {
      addLog(`[Index] Refresh effect triggered for table:`, table);
      const playerIds = table.players.map((p: any) => p.id).filter(Boolean);
      addLog(`[Index] Player IDs for refresh: ${JSON.stringify(playerIds)}`);
      if (playerIds.length === 0) return;

      // Always fetch latest table info for admin/join code and name from DB
      supabase
        .from('poker_tables')
        .select('*')
        .eq('id', table.id)
        .single()
        .then(async ({ data: tableData, error: tableError }) => {
          addLog(`[Index] DB tableData after refresh:`, tableData);
          // Add this log:
          console.log('[Index] Raw DB tableData:', tableData);

          if (tableError) {
            addLog(`[Index] Error fetching table info: ${tableError.message}`);
          }
          addLog(`[Index] Table ID used for DB fetch: ${table.id}`);

          // Defensive: If tableData is missing, do not update table state
          if (!tableData) {
            addLog('[Index] No tableData returned from DB, skipping table update.');
            setIsRefresh(false);
            return;
          }

          // Fetch admin profile from DB for latest name
          let adminName = '';
          let adminId = tableData.admin_user_id;
          addLog(`[Index] Admin ID from DB: ${adminId}`);
          if (adminId) {
            const { data: adminProfile, error: adminProfileError } = await supabase
              .from('users')
              .select('id,name')
              .eq('id', adminId)
              .maybeSingle();
            if (adminProfileError) {
              addLog(`[Index] Error fetching admin profile: ${adminProfileError.message}`);
            }
            adminName = adminProfile?.name || '';
            addLog(`[Index] DB adminProfile after refresh:`, adminProfile);
          }

          supabase
            .from('users')
            .select('id,name')
            .in('id', playerIds)
            .then(async ({ data: profilesData, error: profilesError }) => {
              addLog(`[Index] DB profilesData after refresh:`, profilesData);
              if (profilesError) {
                addLog(`[Index] Error fetching player profiles: ${profilesError.message}`);
              }

              const { data: buyInsData, error: buyInsError } = await supabase
                .from('buy_ins')
                .select('player_id,amount')
                .eq('table_id', table.id);

              addLog(`[Index] DB buyInsData after refresh:`, buyInsData);
              if (buyInsError) {
                addLog(`[Index] Error fetching buy-ins: ${buyInsError.message}`);
              }

              const buyInTotals: Record<string, number> = {};
              (buyInsData || []).forEach((row: any) => {
                buyInTotals[row.player_id] = (buyInTotals[row.player_id] || 0) + Number(row.amount);
              });

              const mergedPlayers = table.players.map((p: any) => {
                const profile = profilesData?.find((prof: any) => prof.id === p.id);
                const name = profile ? profile.name : p.name;
                const points = buyInTotals[p.id] || 0;
                return { ...p, points, totalPoints: points, name };
              });

              // Prefer DB adminName, fallback to mergedPlayers lookup, then previous value
              if (!adminName) {
                const adminPlayer = mergedPlayers.find((p: any) => p.id === adminId);
                addLog(`[Index] Fallback adminPlayer from mergedPlayers:`, adminPlayer);
                adminName = adminPlayer ? adminPlayer.name : (table.adminName || 'Unknown');
              }

              const joinCode = tableData.join_code || table.joinCode || table.join_code || 'Unknown';
              addLog(`[Index] Final joinCode for table: ${joinCode}`);
              addLog(`[Index] Final table name from DB: ${tableData.name}`);

              addLog(`[Index] PokerTable top section after refresh: joinCode=${joinCode} | adminId=${adminId} | adminName=${adminName} | tableName=${tableData.name}`);

              // Always use DB values for adminId/joinCode/table name
              // Before constructing updatedTable:
              console.log('[Index] Constructing updatedTable with:', {
                id: tableData.id,
                name: tableData.name,
                joinCode: tableData.join_code,
                adminId: tableData.admin_user_id,
                status: tableData.status,
                createdAt: (tableData as any).created_at,
                updatedAt: (tableData as any).updated_at,
                players: mergedPlayers,
                adminName,
              });

              const updatedTable = {
                ...table,
                players: mergedPlayers,
                adminId: tableData.admin_user_id,
                adminName,
                joinCode,
                name: tableData.name,
                createdAt: (tableData as any).created_at,
                updatedAt: (tableData as any).updated_at,
                status: tableData.status,
              };
              // Log before saving to storage:
              console.log('[Index] Saving updatedTable to storage:', updatedTable);
              storage.setTable(updatedTable);
              setTable(updatedTable);
              setIsRefresh(false);
            });
        });
    }
  }, [table, isRefresh]);

  // Add logging for storage contents before rendering PokerTable
  useEffect(() => {
    console.log('[Index] Storage.getProfile:', storage.getProfile());
    console.log('[Index] Storage.getTable:', storage.getTable());
  }, [currentPage, profile, table]);

  // Add logging after table/profile are set from DB/localStorage
  useEffect(() => {
    console.log('[Index] State after DB/localStorage fetch:');
    console.log('  profile:', profile);
    console.log('  table:', table);
  }, [profile, table]);

  if (currentPage === 'onboarding') {
    console.log('[Index] Rendering Onboarding');
    return <Onboarding onSetProfile={handleOnboardingComplete} />;
  }

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
    // Log raw table and profile props before rendering PokerTable
    console.log('[Index] Rendering PokerTable with props:');
    console.log('  table:', table);
    console.log('  profile:', profile);

    // Log storage contents again for comparison
    console.log('[Index] Storage.getTable (before PokerTable render):', storage.getTable());
    console.log('[Index] Storage.getProfile (before PokerTable render):', storage.getProfile());

    // Log joinCode, adminName, tableName, and their presence
    if (table) {
      console.log('[Index] PokerTable top section joinCode:', table.joinCode, '| adminId:', table.adminId, '| adminName:', table.adminName, '| tableName:', table.name);
      console.log('[Index] PokerTable joinCode present?', !!table.joinCode);
      console.log('[Index] PokerTable adminName present?', !!table.adminName);
      console.log('[Index] PokerTable tableName present?', !!table.name);
      // Log all table keys for debugging
      Object.keys(table).forEach(key => {
        console.log(`[Index] Table key: ${key} | value:`, table[key]);
      });
      // Log all players for debugging
      if (Array.isArray(table.players)) {
        table.players.forEach((p: any, idx: number) => {
          console.log(`[Index] Player[${idx}]: id=${p.id} name=${p.name} points=${p.points} totalPoints=${p.totalPoints}`);
        });
      }
    }

    if (!table) {
      const storedTable = storage.getTable();
      console.log('[Index] No table in state, checking storage:', storedTable);
      if (storedTable) setTable(storedTable);
      else return <div className="min-h-screen flex items-center justify-center">No Table Found</div>;
    }

    // Add logging for the total values shown in the below table
    if (table && Array.isArray(table.players)) {
      const playerTotalsLog = table.players.map((p: any) => ({
        id: p.id,
        name: p.name,
        points: p.points,
        totalPoints: p.totalPoints
      }));
      const sumPoints = table.players.reduce((sum: number, p: any) => sum + (typeof p.points === 'number' ? p.points : 0), 0);
      const sumTotalPoints = table.players.reduce((sum: number, p: any) => sum + (typeof p.totalPoints === 'number' ? p.totalPoints : 0), 0);
      console.log('[Index] PokerTable bottom table playerTotals:', playerTotalsLog);
      console.log('[Index] PokerTable bottom table sumPoints:', sumPoints, '| sumTotalPoints:', sumTotalPoints);
    }

    // Only show loading indicator if isRefresh is true
    if (
      isRefresh &&
      table &&
      Array.isArray(table.players) &&
      table.players.length > 0 &&
      table.players.some((p: any) => typeof p.points !== 'number')
    ) {
      console.log('[Index] SHOWING: Loading player points... | isRefresh:', isRefresh, '| table.players:', table.players);
      return <div className="min-h-screen flex items-center justify-center">Loading player points...</div>;
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

export default Index;