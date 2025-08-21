import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Profile } from '@/types';
import { storage, uid } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import { Player } from '@/integrations/supabase/types';

const Onboarding = (props: { onSetProfile?: (profile: Player) => void }) => {
  const navigate = useNavigate();
  const existing = storage.getProfile();
  const [name, setName] = useState(existing?.name ?? '');

  useEffect(() => {
    document.title = 'Onboarding — Poker Buy-in Tracker';
  }, []);

  const onSubmit = async () => {
    if (!name.trim()) return;
    let finalName = name.trim();

    // Check for existing names in the players table
    const { data: existingPlayers, error } = await supabase
      .from('players')
      .select('name')
      .ilike('name', `${finalName}%`);

    if (!error && existingPlayers) {
      // Count how many players have the same base name or base name with _number
      const sameBase = existingPlayers.filter((u: { name: string }) =>
        u.name === finalName || u.name.startsWith(`${finalName}_`)
      );
      if (sameBase.length > 0) {
        finalName = `${finalName}_${sameBase.length}`;
      }
    }

    // Use a valid UUID for id
    const profile: Player = {
      id: uuidv4(),
      name: finalName,
      avatar: null,
    };

    // Save to 'players' table in the database and check for errors
    const { error: insertError } = await supabase.from('players').insert(profile);
    if (insertError) {
      alert(`Failed to save profile. Error: ${insertError.message || 'Unknown error'}`);
      return;
    }

    storage.setProfile(profile);
    props.onSetProfile?.(profile);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-page flex items-center justify-center p-6 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-20 left-20 w-32 h-32 bg-red-500 rounded-full opacity-20 animate-float"></div>
        <div className="absolute top-40 right-32 w-24 h-24 bg-blue-500 rounded-full opacity-20 animate-float" style={{animationDelay: '2s'}}></div>
        <div className="absolute bottom-32 left-32 w-28 h-28 bg-green-500 rounded-full opacity-20 animate-float" style={{animationDelay: '4s'}}></div>
        <div className="absolute bottom-20 right-20 w-20 h-20 bg-yellow-500 rounded-full opacity-20 animate-float" style={{animationDelay: '1s'}}></div>
      </div>

      {/* Main content */}
      <Card className="w-full max-w-md shadow-elegant poker-card relative z-10">
        <CardHeader className="text-center">
          <div className="mb-4">
            {/* Poker chip logo */}
            <div className="poker-chip mx-auto mb-4">
              <span className="text-xs">POKER</span>
            </div>
          </div>
          <CardTitle className="text-3xl font-bold text-gray-800 mb-2">Welcome to the Table</CardTitle>
          <CardDescription className="text-lg text-gray-600">Set up your player profile to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            {/* Playing card suits row with enhanced styling */}
            <div className="flex justify-center gap-8 text-5xl mb-6">
              <span className="card-suit spade animate-bounce-slow" title="Spade">♠️</span>
              <span className="card-suit heart animate-pulse-slow" title="Heart">♥️</span>
              <span className="card-suit diamond animate-float" title="Diamond">♦️</span>
              <span className="card-suit club animate-bounce-slow" title="Club" style={{animationDelay: '1s'}}>♣️</span>
            </div>
            
            <div className="space-y-3">
              <Label htmlFor="name" className="text-lg font-semibold text-gray-700">Player Name</Label>
              <Input
                id="name"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 text-lg border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200"
                onKeyPress={(e) => e.key === 'Enter' && onSubmit()}
              />
            </div>
            
            <Button 
              onClick={onSubmit} 
              className="w-full h-14 text-lg font-bold btn-poker primary"
              disabled={!name.trim()}
            >
              Join the Game
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Decorative elements */}
      <div className="absolute bottom-10 left-10 text-white opacity-30">
        <div className="text-sm">♠️ ♥️ ♦️ ♣️</div>
      </div>
      <div className="absolute top-10 right-10 text-white opacity-30">
        <div className="text-sm">♣️ ♦️ ♥️ ♠️</div>
      </div>
    </div>
  );
};

export default Onboarding;