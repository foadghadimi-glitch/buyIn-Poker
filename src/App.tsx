import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import NotFound from "./pages/NotFound";
import Onboarding from "./pages/Onboarding";
import TableSelection from "./pages/TableSelection";
import PokerTable from "./pages/PokerTable";
import { storage } from "./utils/storage";
import { Player, PokerTable as PokerTableType } from "./integrations/supabase/types";
import { StoragePokerTable, EnhancedPokerTable } from '@/types/table';
import { supabase } from "./integrations/supabase/client";

const queryClient = new QueryClient();

const App = () => {
  const [profile, setProfile] = useState<Player | null>(storage.getProfile());
  const [table, setTable] = useState<PokerTableType | null>(storage.getTable());
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [pendingTable, setPendingTable] = useState<PokerTableType | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const tableToWatch = table || pendingTable;
    if (profile && tableToWatch) {
      const channel = supabase
        .channel("user_" + profile.id)
        .on("broadcast", { event: "join_approved" }, (payload) => {
          if (payload.payload.tableId === tableToWatch.id) {
            setWaitingApproval(false);
            setPendingTable(null);
            setTable(tableToWatch);
            storage.setTable(tableToWatch);
            setRefreshKey((prev) => prev + 1);
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [profile, table, pendingTable]);

  const handleSetProfile = (newProfile: Player | null) => {
    setProfile(newProfile);
    if (!newProfile) {
      storage.setProfile(null);
      storage.setTable(null);
      setTable(null);
    }
  };

  const handleCreateTable = (newTable: PokerTableType) => {
    setTable(newTable);
    storage.setTable(newTable);
  };

  const handleJoinTable = (joinedTable: PokerTableType) => {
    // DO NOT set the main table state here.
    // This keeps the user on the TableSelection page.
    setPendingTable(joinedTable);
    setWaitingApproval(true);
  };

  const handleExitTable = () => {
    setTable(null);
    storage.setTable(null);
    setWaitingApproval(false);
  };

  const handleSwitchPlayer = () => {
    handleSetProfile(null);
  };

  const renderContent = () => {
    if (!profile) {
      return <Navigate to="/onboarding" replace />;
    }
    if (!table) {
      return (
        <TableSelection
          profile={profile}
          table={table}
          onCreateTable={handleCreateTable}
          onJoinTable={handleJoinTable}
          waitingApproval={waitingApproval}
          onSwitchPlayer={handleSwitchPlayer}
        />
      );
    }
      return (
        <PokerTable
          table={{
            ...table,
            players: []
          } as EnhancedPokerTable}
          profile={profile}
          onExit={handleExitTable}
          refreshKey={refreshKey}
        />
      );
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route
              path="/onboarding"
              element={<Onboarding onSetProfile={handleSetProfile} />}
            />
            <Route path="/" element={renderContent()} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
