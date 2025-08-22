import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Profile } from '@/types';
import { storage, uid } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import { Player } from '@/integrations/supabase/types';
import { toast } from 'sonner';

const Onboarding = (props: { onSetProfile?: (profile: Player) => void }) => {
  const navigate = useNavigate();
  const existing = storage.getProfile();
  const [name, setName] = useState(existing?.name ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Onboarding — Poker Buy-in Tracker';
  }, []);

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('Please enter your name.');
      return;
    }

    setIsSubmitting(true);
    let finalName = name.trim();

    try {
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
        toast.error(`Failed to save profile. Error: ${insertError.message || 'Unknown error'}`);
        return;
      }

      storage.setProfile(profile);
      props.onSetProfile?.(profile);
      navigate('/');
      toast.success(`Welcome to the poker table, ${profile.name}!`);
    } catch (error) {
      console.error('Error creating profile:', error);
      toast.error('Failed to create profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSubmit();
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-center bg-cover"
      style={{ backgroundImage: "url('/Poker_02.png')" }}
    >
      {/* Overlay to darken the background image */}
      <div className="absolute inset-0 bg-black/40"></div>

      {/* Main content card */}
      <Card
        className="
          w-full max-w-md
          relative z-10
          bg-black/50
          backdrop-blur-md
          border border-white/20
          text-white
          shadow-2xl
        "
      >
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-white mb-2">Welcome to the Poker Table</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Label htmlFor="name" className="text-lg font-semibold text-gray-200">Player Name</Label>
            <Input
              id="name"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 text-lg border-2 border-white/30 focus:border-white/50 focus:ring-2 focus:ring-white/30 transition-all duration-200 bg-white/10 text-white placeholder-gray-300 text-center font-medium"
              onKeyPress={handleKeyPress}
              maxLength={30}
              autoFocus
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || !name.trim()}
            className="w-full h-14 text-lg font-bold btn-poker primary bg-green-600 hover:bg-green-700 text-white py-6"
          >
            {isSubmitting ? 'Joining...' : 'Join the Poker Table'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Onboarding;