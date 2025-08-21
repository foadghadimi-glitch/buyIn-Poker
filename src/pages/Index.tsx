import { useEffect, useState } from 'react';
import Onboarding from './Onboarding';
import TableSelection from './TableSelection';
import PokerTable from './PokerTable';
import { storage } from '@/utils/storage';
import { supabase } from '@/integrations/supabase/client';
import { Player, PokerTable as PokerTableType, TablePlayer } from '@/integrations/supabase/types';

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

type TableWithPlayers = PokerTableType & {
  players: TablePlayer[];
  adminName?: string;
  joinCode?: number;
  adminId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const Index = () => {
  const [profile, setProfile] = useState<Player | null>(storage.getProfile());
  const [currentPage, setCurrentPage] = useState<'onboarding' | 'tableSelection' | 'pokerTable'>(
    profile ? 'tableSelection' : 'onboarding'
  );
  const [table, setTable] = useState<TableWithPlayers | null>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [isRefresh, setIsRefresh] = useState(true);
  // add state for players loaded from table_players
  const [players, setPlayers] = useState<TablePlayer[]>(storage.getTable()?.players || []);

  // Helper to add debug logs
  const addLog = (msg: string, obj?: unknown) => {
    setDebugLogs(logs => [...logs.slice(-40), msg + (obj ? ' ' + JSON.stringify(obj) : '')]);
  };

  // loader: load players for table from table_players -> players table
  const loadPlayersFromJoinTable = async (tableId?: string) => {
    if (!tableId) return;
    try {
      const { data: joinRows, error: joinError } = await supabase
        .from('table_players')
        .select('*')
        .eq('table_id', tableId);
      if (joinError) {
        console.warn('loadPlayersFromJoinTable joinRows error', joinError);
        setPlayers([]);
        return;
      }
              // Only use player_id (our schema doesn't have user_id)
        const ids = (joinRows || []).map((r: { player_id: string }) => r.player_id).filter(Boolean);
      if (!ids.length) {
        setPlayers([]);
        return;
      }
      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('id,name')
        .in('id', ids);
      if (playersError) {
        console.warn('loadPlayersFromJoinTable playersData error', playersError);
        setPlayers([]);
        return;
      }
      // map to expected shape and attach default totals (0)
      const newPlayers: TablePlayer[] = (playersData || []).map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
        totalPoints: 0,
        active: true
      }));
      setPlayers(newPlayers);
    } catch (e) {
      console.error('loadPlayersFromJoinTable error', e);
      setPlayers([]);
    }
  };

  // Real-time subscription for poker_tables updates (for join approval)
  useEffect(() => {
    if (!table || !table.id || !waitingApproval) return;

    // Add debug log to show fetched table players and current user id
    const fetchTable = async () => {
      addLog('[Index] fetchTable called');
      const { data: tableData, error } = await supabase
        .from('poker_tables')
        .select('*')
        .eq('id', table.id)
        .single();

      addLog('[Index] Real-time fetchTable triggered. Data:', tableData);

      if (!error && tableData) {
        const profile = storage.getProfile();

        // Check membership via table_players.player_id (do not rely on poker_tables.players)
        const { data: joinRow, error: jrErr } = await supabase
          .from('table_players')
          .select('player_id')
          .eq('table_id', table.id)
          .eq('player_id', profile?.id)
          .maybeSingle();

        const isPlayer = !!joinRow;

        if (isPlayer) {
          addLog('[Index] User found in table_players. Moving to PokerTable', { profileId: profile?.id });
          if (currentPage === 'tableSelection' && waitingApproval) {
                          const tableObj: TableWithPlayers = {
                id: tableData.id,
                name: tableData.name,
                joinCode: tableData.join_code,
                adminId: tableData.admin_player_id, // ensure admin_player_id
                status: tableData.status,
                createdAt: tableData.created_at,
                updatedAt: tableData.updated_at,
                players: [],
              };
            storage.setTable(tableObj);
            setTable(tableObj);
            setWaitingApproval(false);
            setCurrentPage('pokerTable');
          }
        } else {
          addLog('[Index] User not in table_players. Checking join_requests...', { profileId: profile?.id });
          const { data: joinReqs, error: joinError } = await supabase
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
  const handleOnboardingComplete = async (profileData: Player) => {
    console.log('[Index] Onboarding complete:', profileData);
    // Check if profile exists in Supabase
    const { data: existingProfile, error } = await supabase
      .from('players')
      .select('id')
      .eq('id', profileData.id)
      .maybeSingle();

    if (!existingProfile && !error) {
      // Insert profile if not exists
      await supabase.from('players').insert([profileData]);
    }
    storage.setProfile(profileData);
    setProfile(profileData);
    setCurrentPage('tableSelection');
    setIsRefresh(false); // <-- Always set to false after onboarding
  };

  // Fix: Ensure table is set after join request
  // Add debug log to show which table is being set
  // Add debug log to show when handleTableSelected is called for join requests
  const handleTableSelected = (createdTable?: TableWithPlayers, joinPending?: boolean) => {
    console.log('[Index] Table created/selected:', createdTable);
    addLog(`[Index] handleTableSelected called. joinPending=${joinPending}, createdTable=${JSON.stringify(createdTable)}`);
    if (createdTable) {
      storage.setTable(createdTable);
      setTable({ ...createdTable });
      // load players separately
      loadPlayersFromJoinTable(createdTable.id);
      setIsRefresh(true);
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
      Array.isArray(players) &&
      players.some((p: TablePlayer) => p.id === profile.id)
    ) {
      setCurrentPage('pokerTable');
    }
  }, [profile, table, players]);

  // Fix: Only auto-transition to PokerTable if the current user is NOT the admin
  useEffect(() => {
    if (
      profile &&
      table &&
      Array.isArray(players) &&
      players.some((p: TablePlayer) => p.id === profile.id) &&
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
        setTable(storedTable as TableWithPlayers);
        // Decide initial page based on local storage
        if (storedProfile.id === storedTable.admin_player_id) {
          setCurrentPage('pokerTable');
        } else if (
          Array.isArray(storedTable.players) &&
          storedTable.players.some((p: TablePlayer) => p.id === storedProfile.id)
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
        .from('players')
        .select('*')
        .eq('id', storedProfile.id)
        .maybeSingle()
        .then(({ data: profileData, error: profileError }) => {
          if (!profileError && profileData) {
            storage.setProfile(profileData);
            setProfile(profileData);
          } else {
            addLog(`[Index] Warning: Profile not found for id ${storedProfile.id}, keeping local profile.`);
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
              // Players are stored in join table; don't read from poker_tables
              // Note: Points will be merged in the refresh effect using buy_ins
              const mergedPlayers = Array.isArray(players) ? players : [];
              
              const tableObj: TableWithPlayers = {
                id: data.id,
                name: data.name,
                joinCode: data.join_code,
                adminId: data.admin_player_id, // <-- updated
                status: data.status,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                players: mergedPlayers,
                admin_user_id: data.admin_user_id,
                is_anonymous: data.is_anonymous,
                original_admin_id: data.original_admin_id,
              };
              // Log before saving to storage:
              console.log('[Index] Saving tableObj to storage:', tableObj);
              storage.setTable(tableObj);
              setTable(tableObj);
              // Load players from join table after refreshing table
              try { await loadPlayersFromJoinTable(data.id); } catch {}
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
      Array.isArray(players) &&
      players.length > 0
    ) {
      addLog(`[Index] Refresh effect triggered for table:`, table);
      const playerIds = players.map((p: TablePlayer) => p.id).filter(Boolean);
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
          let adminId = tableData.admin_player_id; // <-- admin id from table
          addLog(`[Index] Admin ID from DB: ${adminId}`);
          if (adminId) {
            const { data: adminProfile, error: adminProfileError } = await supabase
              .from('players')
              .select('id,name')
              .eq('id', adminId)
              .maybeSingle();
            if (adminProfileError) {
              addLog(`[Index] Error fetching admin profile: ${adminProfileError.message}`);
            }
            adminName = adminProfile?.name || '';
            addLog(`[Index] DB adminProfile after refresh:`, adminProfile);
          }

          // Fetch player profiles for playerIds
          supabase
            .from('players')
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
              (buyInsData || []).forEach((row: { player_id: string; amount: number }) => {
                buyInTotals[row.player_id] = (buyInTotals[row.player_id] || 0) + Number(row.amount);
              });

              const mergedPlayers = players.map((p: TablePlayer) => {
                const profile = profilesData?.find((prof: { id: string; name: string }) => prof.id === p.id);
                const name = profile ? profile.name : p.name;
                const points = buyInTotals[p.id] || 0;
                return { ...p, points, totalPoints: points, name };
              });

              // Prefer DB adminName, fallback to mergedPlayers lookup, then previous value
              if (!adminName) {
                const adminPlayer = mergedPlayers.find((p: TablePlayer) => p.id === adminId);
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
                adminId: tableData.admin_player_id, // <-- use admin_player_id
                status: tableData.status,
                createdAt: tableData.created_at,
                updatedAt: tableData.updated_at,
                players: mergedPlayers,
                adminName,
              });

              const updatedTable: TableWithPlayers = {
                ...table,
                players: mergedPlayers,
                adminId: tableData.admin_player_id, // <-- use admin_player_id
                adminName,
                joinCode,
                name: tableData.name,
                createdAt: tableData.created_at,
                updatedAt: tableData.updated_at,
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
  }, [table, isRefresh, players]);

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
        console.log(`[Index] Table key: ${key} | value:`, table[key as keyof TableWithPlayers]);
      });
      // Log all players for debugging
      if (Array.isArray(players)) {
        players.forEach((p: TablePlayer, idx: number) => {
          console.log(`[Index] Player[${idx}]: id=${p.id} name=${p.name} points=${(p as any).points} totalPoints=${p.totalPoints}`);
        });
      }
    }

    if (!table) {
      const storedTable = storage.getTable();
      console.log('[Index] No table in state, checking storage:', storedTable);
      if (storedTable) setTable(storedTable as TableWithPlayers);
      else return <div className="min-h-screen flex items-center justify-center">No Table Found</div>;
    }

    // Add logging for the total values shown in the below table
    if (table && Array.isArray(players)) {
      const playerTotalsLog = players.map((p: TablePlayer) => ({
        id: p.id,
        name: p.name,
        points: (p as any).points,
        totalPoints: p.totalPoints
      }));
      const sumPoints = players.reduce((sum: number, p: TablePlayer) => sum + (typeof (p as any).points === 'number' ? (p as any).points : 0), 0);
      const sumTotalPoints = players.reduce((sum: number, p: TablePlayer) => sum + (typeof p.totalPoints === 'number' ? p.totalPoints : 0), 0);
      console.log('[Index] PokerTable bottom table playerTotals:', playerTotalsLog);
      console.log('[Index] PokerTable bottom table sumPoints:', sumPoints, '| sumTotalPoints:', sumTotalPoints);
    }

    // Only show loading indicator if isRefresh is true
    if (
      isRefresh &&
      table &&
      Array.isArray(players) &&
      players.length > 0 &&
      players.some((p: TablePlayer) => typeof (p as any).points !== 'number')
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