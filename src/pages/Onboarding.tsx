import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Profile } from '@/types';
import { storage, uid } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
const Onboarding = () => {
  const navigate = useNavigate();
  const existing = storage.getProfile();
  const [name, setName] = useState(existing?.name ?? '');
  const [avatar, setAvatar] = useState<string | null>(existing?.avatar ?? null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.title = 'Onboarding — Poker Buy-in Tracker';
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // no async calls here per best practices
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/auth');
    });
    return () => subscription.unsubscribe();
  }, []);
  const onPick = () => fileRef.current?.click();

  const onFile = async (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(f);
  };

  const onSubmit = async () => {
    if (!name.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    const supaUserId = session?.user?.id;
    const profile: Profile = {
      id: existing?.id ?? (supaUserId || uid('p_')),
      name: name.trim(),
      avatar,
    };
    storage.setProfile(profile);

    if (supaUserId) {
      const { error } = await (supabase as any).from('profiles').upsert({
        id: supaUserId,
        display_name: name.trim(),
        avatar_url: avatar,
      });
      if (error) console.error('Failed to save profile to DB', error);
    }

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
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={onPick}
                className="relative inline-flex h-16 w-16 items-center justify-center rounded-full border border-border bg-muted/40 hover:bg-muted transition-colors"
                aria-label="Choose avatar"
              >
                {avatar ? (
                  <img src={avatar} alt="Player avatar" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <span className="text-sm text-muted-foreground">Add</span>
                )}
              </button>
              <div className="space-y-2 flex-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files && onFile(e.target.files[0])}
            />

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
