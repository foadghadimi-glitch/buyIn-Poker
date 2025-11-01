# 🔍 Critical: Check Your Database Migration

## ⚠️ Most Likely Issue

Your Supabase database probably doesn't have the `game_number` column yet!

The code is correct, but the database needs the migration applied.

---

## ✅ Step 1: Verify Database Has game_number

**Go to Supabase Dashboard:**

1. Open your project: https://tglohosjdjqmonnlvawe.supabase.co
2. Click **"Table Editor"** in left sidebar
3. Select **`game_profits`** table
4. Look at the column headers

**You should see these columns:**
- id
- table_id
- game_id
- **game_number** ← **MUST BE HERE**
- player_id
- profit
- created_at
- updated_at

---

## ❌ If game_number is MISSING

### Step 2: Run This SQL Migration

**In Supabase Dashboard:**

1. Click **"SQL Editor"** in left sidebar
2. Click **"New Query"**
3. Paste this entire script:
```sql
-- Safe migration: Add game_number to game_profits without data loss

-- 1. Add game_number column if it doesn't exist
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

-- 2. Populate game_number from games table for existing rows
UPDATE public.game_profits gp
SET game_number = g.game_number
FROM public.games g
WHERE gp.game_id = g.id
AND gp.game_number IS NULL;

-- 3. Make game_number NOT NULL after populating
ALTER TABLE public.game_profits 
ALTER COLUMN game_number SET NOT NULL;

-- 4. Add index for game_number queries if it doesn't exist
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_game_profits_game_number'
    ) THEN
        CREATE INDEX idx_game_profits_game_number 
        ON public.game_profits(table_id, game_number);
    END IF;
END $$;
```

4. Click **"Run"** (green button)
5. Wait for "Success" message

---

## ✅ Step 3: Verify Migration Worked

**Run this query in SQL Editor:**

```sql
-- Check if game_number exists and has data
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'game_profits' 
AND column_name = 'game_number';
```

**Expected output:**
```
column_name  | data_type
game_number  | integer
```

**Also check existing data:**

```sql
-- Check for any NULL game_number values
SELECT COUNT(*) 
FROM game_profits 
WHERE game_number IS NULL;
```

**Expected:** `0` (zero NULL values)

---

## 🔄 Step 4: Rebuild Android App

After migration is applied:

```bash
npm run android
```

Then in Android Studio, run the app.

---

## 🧪 Step 5: Test

1. Create a new table
2. Start Game 1
3. Enter end-up values and save
4. Start Game 2
5. Enter end-up values and save
6. **It should work now!**

---

## ❓ If Still Not Working

### Check Console Logs in Android Studio

When you click "Save End Up", look at the Android Studio console/logcat for errors.

### Common Errors:

**Error: "column game_number does not exist"**
- Database migration wasn't applied
- Run Step 2 above

**Error: "null value in column game_number"**
- Old data exists without game_number
- Run the UPDATE in Step 2

**Error: "duplicate key value"**
- Conflict in unique constraint
- Check your onConflict clause

---

## 📝 Summary

**The fix we made:**
1. ✅ Updated TypeScript types
2. ✅ Removed created_at from profitRow
3. ✅ Code is correct

**What you need to do:**
1. ✅ Check if game_number column exists in database
2. ✅ If not, run the SQL migration
3. ✅ Rebuild Android app
4. ✅ Test

---

**Your database URL:** https://tglohosjdjqmonnlvawe.supabase.co  
**Go there now and check the game_profits table!**

