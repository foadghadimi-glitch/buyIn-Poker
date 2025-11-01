# 🐛 Debugging Android End-Up Issue

## What We Know Works

1. ✅ TypeScript types updated with `game_number`
2. ✅ Code in `handleSaveEndUp` sets `game_number`
3. ✅ Database schema has `game_number` column
4. ✅ Build and sync completed successfully

## Potential Issues

### Issue 1: Database Migration Not Applied

**Problem:** Your production database might not have `game_number` column yet.

**Check:** In Supabase dashboard:
1. Go to Table Editor
2. Open `game_profits` table
3. Check if `game_number` column exists

**Fix:** Run the migration:
```sql
-- In Supabase SQL Editor, run:
ALTER TABLE public.game_profits 
ADD COLUMN IF NOT EXISTS game_number integer;

-- Then populate existing data
UPDATE public.game_profits gp
SET game_number = g.game_number
FROM public.games g
WHERE gp.game_id = g.id
AND gp.game_number IS NULL;

-- Then make it NOT NULL
ALTER TABLE public.game_profits 
ALTER COLUMN game_number SET NOT NULL;
```

### Issue 2: Old Data Without game_number

**Problem:** Old game_profits rows have NULL game_number.

**Check:** Run this query in Supabase:
```sql
SELECT * FROM game_profits WHERE game_number IS NULL;
```

**Fix:** The UPDATE query above will populate them.

### Issue 3: Created_at Field Issue

**Problem:** Including `created_at` in upsert might cause issues.

**Current code:**
```typescript
const profitRow = {
  table_id: table.id,
  game_id: currentGame.id,
  game_number: currentGame.game_number,
  player_id: playerId,
  profit: profit,
  created_at: new Date().toISOString()  // ← Might cause issues on update
};
```

**Fix:** Remove `created_at` - it's auto-set by the database.

---

## Immediate Action Plan

### Step 1: Verify Database

Run this in Supabase SQL Editor:
```sql
-- Check if column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'game_profits' 
AND column_name = 'game_number';
```

### Step 2: If Missing, Run Migration

```sql
-- Safe migration
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_profits' 
        AND column_name = 'game_number'
    ) THEN
        ALTER TABLE public.game_profits 
        ADD COLUMN game_number integer;
    END IF;
END $$;

-- Populate data
UPDATE public.game_profits gp
SET game_number = g.game_number
FROM public.games g
WHERE gp.game_id = g.id
AND gp.game_number IS NULL;

-- Make NOT NULL
ALTER TABLE public.game_profits 
ALTER COLUMN game_number SET NOT NULL;
```

### Step 3: Fix Code

Remove `created_at` from profitRow.

### Step 4: Test

Rebuild and test.

---

## Next: Clean Up Code

Remove `created_at` from the profitRow object.

