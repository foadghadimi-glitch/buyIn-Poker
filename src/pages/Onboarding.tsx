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

const Onboarding = (props: { onSetProfile?: (profile: any) => void }) => {
  const navigate = useNavigate();
  const existing = storage.getProfile();
  const [name, setName] = useState(existing?.name ?? '');

  useEffect(() => {
    document.title = 'Onboarding — Poker Buy-in Tracker';
  }, []);

  const onSubmit = async () => {
    if (!name.trim()) return;
    let finalName = name.trim();

    // Check for existing names in the users table
    const { data: existingUsers, error } = await supabase
      .from('users')
      .select('name')
      .ilike('name', `${finalName}%`);

    if (!error && existingUsers) {
      // Count how many users have the same base name or base name with _number
      const sameBase = existingUsers.filter((u: { name: string }) =>
        u.name === finalName || u.name.startsWith(`${finalName}_`)
      );
      if (sameBase.length > 0) {
        finalName = `${finalName}_${sameBase.length}`;
      }
    }

    // Use a valid UUID for id
    const profile: Profile = {
      id: uuidv4(),
      name: finalName,
      avatar: null,
    };

    // Save to 'users' table in the database and check for errors
    const { error: insertError } = await supabase.from('users').insert(profile);
    if (insertError) {
      alert(`Failed to save profile. Error: ${insertError.message || 'Unknown error'}`);
      return;
    }

    storage.setProfile(profile);
    props.onSetProfile?.(profile);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-page flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>Set up your player profile</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            {/* Playing card suits row */}
            <div className="flex justify-center gap-6 text-4xl mb-2">
              <span title="Spade" style={{color: "#222"}}>♠️</span>
              <span title="Heart" style={{color: "#e53e3e"}}>♥️</span>
              <span title="Diamond" style={{color: "#3182ce"}}>♦️</span>
              <span title="Club" style={{color: "#222"}}>♣️</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button onClick={onSubmit} className="w-full" variant="hero">
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;