import { useEffect, useState } from 'react';
import Onboarding from './Onboarding';
import TableSelection from './TableSelection';
import PokerTable from './PokerTable';
import { storage } from '@/utils/storage';
import { supabase } from '@/integrations/supabase/client';
import { Player, PokerTable as PokerTableType, TablePlayer } from '@/integrations/supabase/types';
import { v4 as uuidv4 } from 'uuid';

// --- MOVED HERE (was at bottom) ---
const userChannelCache: Record<string, ReturnType<typeof supabase.channel>> = {};
const ensureUserChannelSubscribed = async (userId: string) => {
  const name = 'user_' + userId;
  if (!userChannelCache[name]) {
    userChannelCache[name] = supabase.channel(name);
    console.log('[Index][Realtime] Created channel object', name);
  }
  const ch = userChannelCache[name];
  if ((ch as any).state !== 'joined') {
    console.log('[Index][Realtime] Subscribing channel', name);
    await new Promise<void>((resolve) => {
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Index][Realtime] Channel subscribed', name);
          resolve();
        }
      });
      setTimeout(() => resolve(), 2000);
    });
  }
  return ch;
};
// --- end moved block ---

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

// NEW: mapping helper to enforce consistent camelCase shape (enhanced to inject adminName)
const mapDbTableToAppTable = (
  raw: any,
  players: TablePlayer[] = [],
  currentProfile?: Player | null
): TableWithPlayers => {
  if (!raw) return raw;
  const adminId = raw.admin_player_id ?? raw.adminId;
  const derivedAdminName =
    raw.adminName ??
    raw.admin_name ??
    (adminId && currentProfile?.id === adminId ? currentProfile.name : '');
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    players: Array.isArray(raw.players) ? raw.players : players,
    joinCode: raw.join_code ?? raw.joinCode,
    adminId,
    adminName: derivedAdminName,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  } as TableWithPlayers;
};

// Helper to enforce adminId/adminName consistency & emit diagnostics
const ensureAdminNormalization = (
  tbl: TableWithPlayers,
  profile: Player | null,
  context: string,
  addLogFn: (m: string, o?: any) => void
): TableWithPlayers => {
  let changed = false;
  let adminId = tbl.adminId || (tbl as any).admin_player_id;
  let adminName = tbl.adminName;
  if (!adminId && (tbl as any).admin_player_id) {
    adminId = (tbl as any).admin_player_id;
    changed = true;
  }
  if (adminId && !adminName && profile && profile.id === adminId) {
    adminName = profile.name;
    changed = true;
  }
  if (!adminId) {
    addLogFn('[AdminCheck] WARNING: Table missing adminId', { context, tableId: tbl.id, rawKeys: Object.keys(tbl) });
  }
  if (changed) {
    const updated = { ...tbl, adminId, adminName };
    addLogFn('[AdminCheck] Normalized admin fields', { context, adminId, adminName });
    return updated;
  }
  addLogFn('[AdminCheck] Admin fields OK', { context, adminId, adminName });
  return tbl;
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
  const [refreshKey, setRefreshKey] = useState(0); // ADD
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

  // REPLACED handleTableSelected (old version caused race via early setTable + setIsRefresh)
  const handleTableSelected = async (selectedTable?: TableWithPlayers, isJoin?: boolean) => {
    addLog('[Index][handleTableSelected] invoked', { isJoin, selectedTable });
    console.log('[Index][handleTableSelected] START', { isJoin, tableId: selectedTable?.id });

    if (!selectedTable) {
      console.log('[Index][handleTableSelected] CLEAR selection');
      storage.setTable(null);
      setTable(null);
      setWaitingApproval(false);
      setCurrentPage('tableSelection');
      return;
    }
    // MAP incoming (may be snake_case from DB/TableSelection)
    const mapped = ensureAdminNormalization(
      mapDbTableToAppTable(selectedTable, [], profile),
      profile,
      'handleTableSelected:initial',
      addLog
    );
    const tableId = mapped.id;
    const adminId = mapped.adminId;

    if (!isJoin) {
      const mappedWithAdmin = ensureAdminNormalization(
        mapped.adminName ? mapped : { ...mapped, adminName: profile?.name || '' },
        profile,
        'handleTableSelected:createFlow',
        addLog
      );
      addLog('[AdminCheck] CREATE FLOW final table state', { adminId: mappedWithAdmin.adminId, adminName: mappedWithAdmin.adminName });
      storage.setTable(mappedWithAdmin);
      setTable(mappedWithAdmin);
      setWaitingApproval(false);
      setCurrentPage('pokerTable');
      // Load players (admin already added by creator flow elsewhere)
      try { await loadPlayersFromJoinTable(tableId); } catch {}
      return;
    }

    if (!profile) {
      console.log('[Index][handleTableSelected] ABORT: no profile loaded');
      return;
    }

    const isAdmin = !!adminId && profile.id === adminId;
    let isReturning = false;

    try {
      if (!isAdmin) {
        console.log('[Index][handleTableSelected] Checking table_players membership', { tableId, playerId: profile.id });
        const { data: tpRow, error: tpErr } = await supabase
          .from('table_players')
          .select('table_id')
          .eq('table_id', tableId)
          .eq('player_id', profile.id)
          .maybeSingle();
        if (tpErr) console.warn('[Index][handleTableSelected] table_players lookup error (ignored)', tpErr);
        isReturning = !!tpRow;
        console.log('[Index][handleTableSelected] membership result', { isReturning });
      }
    } catch (e) {
      console.warn('[Index][handleTableSelected] membership probe exception', e);
    }

    if (isAdmin || isReturning) {
      addLog('[AdminCheck] FAST-PATH pre-normalization', { adminId: mapped.adminId, adminName: mapped.adminName });
      const fastPathTable = ensureAdminNormalization(mapped, profile, 'handleTableSelected:fastPath', addLog);
      storage.setTable(fastPathTable);
      setTable(fastPathTable);
      addLog('[AdminCheck] FAST-PATH final table state', { adminId: fastPathTable.adminId, adminName: fastPathTable.adminName });
      setWaitingApproval(false);
      setCurrentPage('pokerTable');
      try { await loadPlayersFromJoinTable(tableId); } catch {}
      return;
    }

    console.log('[Index][handleTableSelected] NEW PLAYER -> join_request path', { tableId, playerId: profile.id, adminId });

    let createdRequestId: string | null = null;

    try {
      console.log('[Index][handleTableSelected] Checking existing pending join_request');
      const { data: existingReq, error: existingReqErr } = await supabase
        .from('join_requests')
        .select('id')
        .eq('table_id', tableId)
        .eq('player_id', profile.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingReqErr) {
        console.warn('[Index][handleTableSelected] existing join_request check error (ignored)', existingReqErr);
      }

      if (existingReq) {
        console.log('[Index][handleTableSelected] Existing pending request found', existingReq);
        createdRequestId = existingReq.id;
      } else {
        const reqId = uuidv4();
        console.log('[Index][handleTableSelected] Inserting new join_request', { reqId });
        const t0 = performance.now();
        const { error: insertErr } = await supabase.from('join_requests').insert({
          id: reqId,
          table_id: tableId,
          player_id: profile.id,
          status: 'pending',
          created_at: new Date().toISOString()
        });
        console.log('[Index][handleTableSelected] join_request insert duration(ms)', Math.round(performance.now() - t0));
        if (insertErr) {
          console.error('[Index][handleTableSelected] join_request insert FAILED', insertErr);
        } else {
          createdRequestId = reqId;
          console.log('[Index][handleTableSelected] join_request inserted OK', { reqId });
        }
      }
    } catch (e) {
      console.error('[Index][handleTableSelected] join_request creation EXCEPTION', e);
    }

    if (createdRequestId && adminId) {
      try {
        console.log('[Index][handleTableSelected] Broadcasting join_request_created', { createdRequestId, adminId });
        const ch = await ensureUserChannelSubscribed(adminId);
        const tSend = performance.now();
        const sendResult = await ch.send({
          type: 'broadcast',
          event: 'join_request_created',
          payload: {
            requestId: createdRequestId,
            playerName: profile.name,
            tableId,
            senderPlayerId: profile.id,
            ts: new Date().toISOString()
          }
        });
        console.log('[Index][handleTableSelected] Broadcast result', { ok: sendResult === 'ok', ms: Math.round(performance.now() - tSend) });
      } catch (e) {
        console.warn('[Index][handleTableSelected] Broadcast failed (ignored)', e);
      }
    } else {
      if (!adminId) console.log('[Index][handleTableSelected] Broadcast skipped: no adminId');
      if (!createdRequestId) console.log('[Index][handleTableSelected] Broadcast skipped: no requestId');
    }

    console.log('[Index][handleTableSelected] Final state: waiting for approval', { tableId });
    // Commit final state for waiting approval
    const waitingTable = ensureAdminNormalization(mapped, profile, 'handleTableSelected:waiting', addLog);
    storage.setTable(waitingTable);
    setTable(waitingTable);
    addLog('[AdminCheck] WAITING APPROVAL table state', { adminId: waitingTable.adminId, adminName: waitingTable.adminName });
    setWaitingApproval(true);
    setCurrentPage('tableSelection');
  };

  // Helper: safely upsert a table_players row (defensive: skip if inputs missing)
  const safeUpsertTablePlayer = async (tableId?: string, playerId?: string, status: string = 'active') => {
    if (!tableId || !playerId) {
      addLog('[Index] safeUpsertTablePlayer: missing tableId or playerId, skipping', { tableId, playerId });
      return;
    }
    try {
      await supabase
        .from('table_players')
        .upsert({ table_id: tableId, player_id: playerId, status }, { onConflict: 'table_id,player_id' });
    } catch (e) {
      console.warn('[Index] safeUpsertTablePlayer failed (ignored):', e);
      addLog('[Index] safeUpsertTablePlayer error (ignored)', { tableId, playerId, err: (e as any)?.message || e });
    }
  };

  // Fix: Ensure onboarding is shown if profile is missing
  useEffect(() => {
    if (!profile) {
      setCurrentPage('onboarding');
    }
  }, [profile]);

  // Restore session from local storage on initial load
  useEffect(() => {
    const storedProfile = storage.getProfile();
    const storedTable = storage.getTable();

    // Use local storage for initial state
    if (storedProfile) {
      setProfile(storedProfile);
      if (storedTable && storedTable.id) {
        const mappedStored = mapDbTableToAppTable(storedTable, storedTable.players || [], storedProfile);
        setTable(ensureAdminNormalization(mappedStored, storedProfile, 'restore:storage', addLog));
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
              const baseMapped = mapDbTableToAppTable(data, players, storedProfile);
              const mergedPlayers = Array.isArray(players) ? players : [];
              const tableObj: TableWithPlayers = { ...baseMapped, players: mergedPlayers };
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

          // ADDED: map + normalize before later usage (fixes mappedDb ReferenceError)
          const mappedDb = ensureAdminNormalization(
            mapDbTableToAppTable(tableData, table.players || [], profile),
            profile,
            'refresh:baseMap',
            addLog
          );

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

              // When building updatedTable (unchanged structure) we now safely spread mappedDb
              const updatedTable: TableWithPlayers = ensureAdminNormalization(
                {
                  ...mappedDb,
                  players: mergedPlayers,
                  adminName,
                },
                profile,
                'refresh:final',
                addLog
              );
              addLog('[AdminCheck] REFRESH final table state', { adminId: updatedTable.adminId, adminName: updatedTable.adminName });
              // Log before saving to storage:
              console.log('[Index] Saving updatedTable to storage:', updatedTable);
              storage.setTable(updatedTable);
              setTable(updatedTable);
              setIsRefresh(false);
            });
        });
    }
  }, [table, isRefresh, players]);

  // REPLACEMENT: Focused listener for join approvals / rejections.
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel('user_' + profile.id)
      .on('broadcast', { event: 'join_approved' }, async (payload) => {
        try {
          const approvedTableId = payload?.payload?.tableId;
          if (!approvedTableId) return;
          // Avoid redundant refetch if already on table and inside pokerTable
          if (table?.id === approvedTableId && currentPage === 'pokerTable') return;

            addLog('[Index] join_approved received. Fetching table...', { approvedTableId });

          const { data, error } = await supabase
            .from('poker_tables')
            .select('*')
            .eq('id', approvedTableId)
            .maybeSingle();

          if (error || !data) {
            addLog('[Index] join_approved: failed to fetch table', { error: error?.message });
            return;
          }

          // REMOVED: raw storage.setTable(data)
          // ADDED: only mapped & normalized version persisted
          const mappedApproved = ensureAdminNormalization(
            mapDbTableToAppTable(data, table?.players || [], profile),
            profile,
            'join_approved',
            addLog
          );
          storage.setTable(mappedApproved);
          setTable(mappedApproved);
          addLog('[AdminCheck] JOIN APPROVED table state', { adminId: mappedApproved.adminId, adminName: mappedApproved.adminName });
          setWaitingApproval(false);
          setCurrentPage('pokerTable');
        } catch (e) {
          console.error('[Index] join_approved handler error:', e);
          addLog('[Index] join_approved handler error', { err: (e as any)?.message });
        }
      })
      .on('broadcast', { event: 'join_rejected' }, (payload) => {
        try {
          const rejectedTableId = payload?.payload?.tableId;
          if (!rejectedTableId) return;
          if (table?.id === rejectedTableId) {
            addLog('[Index] join_rejected received for current table. Clearing state.');
            setWaitingApproval(false);
            setTable(null);
            try { storage.setTable(null); } catch {}
            setCurrentPage('tableSelection');
          }
        } catch (e) {
          console.error('[Index] join_rejected handler error:', e);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, table?.id, currentPage]);

  // NEW: Ensure admin is subscribed to its user_* channel for join_request_created events
  useEffect(() => {
    if (!profile?.id) return;
    // Only meaningful if this user is (or may become) the admin of the current table
    const isAdmin = table && (table.adminId || (table as any).admin_player_id) === profile.id;
    if (!isAdmin) return;

    const channelName = 'user_' + profile.id;
    console.log('[Index][AdminJoinReqListener] Subscribing for join_request_created', { channelName, tableId: table?.id });

    const ch = supabase
      .channel(channelName)
      .on('broadcast', { event: 'join_request_created' }, payload => {
        try {
          console.log('[Index][AdminJoinReqListener] join_request_created received', payload);
          const { requestId, playerName, tableId } = (payload as any)?.payload || {};
          if (table && tableId && tableId !== table.id) {
            console.log('[Index][AdminJoinReqListener] Ignoring request for different table', { current: table.id, got: tableId });
            return;
          }
          addLog('[Index] Admin received join_request_created, triggering child refresh', { requestId, playerName, tableId });
          setRefreshKey(k => k + 1); // ADD: trigger PokerTable refresh
        } catch (e) {
          console.warn('[Index][AdminJoinReqListener] Error handling join_request_created', e);
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.log('[Index][AdminJoinReqListener] Channel subscribed', { channelName });
        }
      });

    return () => {
      console.log('[Index][AdminJoinReqListener] Removing channel', { channelName });
      supabase.removeChannel(ch);
    };
  }, [profile?.id, table?.id, table?.adminId]);

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
    // CHANGED: provide profile so PokerTable can render admin controls
    return <PokerTable table={table} profile={profile} refreshKey={refreshKey} />;
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

// REMOVED duplicate helper previously at bottom
// const userChannelCache: Record<string, ReturnType<typeof supabase.channel>> = {};
// const ensureUserChannelSubscribed = async (userId: string) => { ... };

export default Index;