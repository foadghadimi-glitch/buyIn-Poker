import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { storage } from '@/utils/storage';
import { supabase } from '@/integrations/supabase/client';
import type { Table as PokerTable } from '@/types';

const History = () => {
  const navigate = useNavigate();
  const [table] = useState<PokerTable | null>(storage.getTable());
  const [buyInHistory, setBuyInHistory] = useState<Array<{
    id: string;
    playerName: string;
    amount: number;
    approved_at: string;
  }>>([]);

  useEffect(() => {
    document.title = 'Poker Buy-in Tracker — History';
    
    if (!table) {
      navigate('/');
      return;
    }

    // Fetch buy-in history from Supabase
    const fetchHistory = async () => {
        const { data, error } = await supabase
        .from('buy_ins')
        .select('*')
        .eq('table_id', table.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch buy-in history:', error);
        return;
      }

        const historyWithNames = data.map(buyIn => {
          const player = table.players.find(p => p.id === buyIn.player_id);
          return {
            id: buyIn.id,
            playerName: player?.name || 'Unknown Player',
            amount: parseFloat(String(buyIn.amount)),
            approved_at: buyIn.created_at || '',
          };
        });

      setBuyInHistory(historyWithNames);
    };

    fetchHistory();
  }, [table, navigate]);

  if (!table) return null;

  return (
    <div className="min-h-screen bg-gradient-page">
      <div className="container py-10 space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Buy-in History</h1>
          <Button variant="outline" onClick={() => navigate('/')}>
            Back to Table
          </Button>
        </header>

        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>All Approved Buy-ins</CardTitle>
            <CardDescription>Complete history of approved buy-in requests</CardDescription>
          </CardHeader>
          <CardContent>
            {buyInHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved buy-ins yet</p>
            ) : (
              <UITable>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Approved Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyInHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.playerName}</TableCell>
                      <TableCell className="text-right">
                        {entry.amount >= 0 ? '+' : ''}${entry.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.approved_at ? new Date(entry.approved_at).toLocaleDateString() : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </UITable>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default History;