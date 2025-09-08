import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '@/utils/storage';
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
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Onboarding — Poker Buy-in Tracker';
  }, []);

  // Handler for name input change
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setError('');
  };

  // Handler for submitting the name
  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Please enter your name.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Check for existing names in the players table (case-insensitive)
      const { data: existingPlayers, error } = await supabase
        .from('players')
        .select('name')
        .ilike('name', name.trim());

      if (error) {
        setError('Error checking name. Please try again.');
        setIsSubmitting(false);
        return;
      }

      if (existingPlayers && existingPlayers.length > 0) {
        setError('Name already exists. Please choose a different name.');
        setName('');
        setIsSubmitting(false);
        return;
      }

      // Use a valid UUID for id
      const profile: Player = {
        id: uuidv4(),
        name: name.trim(),
        avatar: null,
      };

      // Save to 'players' table in the database and check for errors
      const { error: insertError } = await supabase.from('players').insert(profile);
      if (insertError) {
        toast.error(`Failed to save profile. Error: ${insertError.message || 'Unknown error'}`);
        setIsSubmitting(false);
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
          bg-card/80
          backdrop-blur-md
          border border-border
          text-card-foreground
          shadow-elegant
        "
      >
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold mb-2">Welcome to the Poker Table</CardTitle>
        </CardHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <CardContent>
            <div className="space-y-4">
              <Label htmlFor="name" className="text-lg font-semibold text-muted-foreground">Player Name</Label>
              <Input
                id="name"
                placeholder="Enter your name"
                value={name}
                onChange={handleNameChange}
                className="h-12 text-lg border border-input focus:border-primary focus:ring-2 focus:ring-ring/30 transition-all duration-200 bg-background text-foreground placeholder-muted-foreground text-center font-medium"
                maxLength={30}
                autoFocus
              />
              {error && (
                <div className="text-red-500 text-sm mt-2">{error}</div>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              variant="hero"
              className="w-full h-14 text-lg font-bold"
            >
              {isSubmitting ? 'Joining...' : 'Join the Poker Table'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default Onboarding;