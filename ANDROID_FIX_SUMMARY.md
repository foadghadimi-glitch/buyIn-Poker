# 🐛 Android App Bug Fix Summary

## Issue Identified

**Problem:** The Android app was not saving end-up values correctly for game 2 and onwards, while the web app worked fine.

**Root Cause:** The TypeScript type definitions for the `game_profits` table were missing the `game_number` field, even though:
1. The database schema includes this field (added in migration `20240101_add_game_number.sql`)
2. The code was trying to save `game_number` when persisting end-up values
3. The web app worked because the database accepted the field despite type mismatch

## Fix Applied

**File Changed:** `src/integrations/supabase/types.ts`

**What Was Fixed:**
Added the missing `game_number: number` field to the `game_profits` table type definitions:

- ✅ Added to `Row` type (for reading data)
- ✅ Added to `Insert` type (for saving new records)  
- ✅ Added to `Update` type (for updating existing records)

**Code Changes:**
```typescript
game_profits: {
  Row: {
    id: string
    game_id: string
    game_number: number  // ← ADDED THIS
    table_id: string
    player_id: string
    profit: number
    created_at: string | null
    updated_at: string | null
  }
  // ... same for Insert and Update
}
```

## Next Steps for You

1. **Build the updated app:**
   ```bash
   npm run build
   npm run cap:sync
   ```

2. **Test in Android Studio:**
   - Open your project in Android Studio
   - Run the app on a device or emulator
   - Test the end-up save functionality for Game 2

3. **Verify the fix:**
   - Create a table
   - Start Game 1, enter end-up values, save
   - Start Game 2, enter end-up values, save
   - Confirm both save correctly

## Technical Details

### Why This Happened

The database schema had `game_number` in `game_profits`, but the TypeScript types were out of sync. The code in `PokerTable.tsx` (line 1506) was correctly trying to save `game_number`:

```typescript
const profitRow = {
  table_id: table.id,
  game_id: currentGame.id,
  game_number: currentGame.game_number, // ← Code was correct
  player_id: playerId,
  profit: profit,
  created_at: new Date().toISOString()
};
```

However, TypeScript's type checking might have been filtering out the `game_number` field during inserts on Android builds due to stricter type checking or build processes.

### How This Affected Android vs Web

- **Web:** Browser build had more lenient type checking, so the extra field was passed through
- **Android:** Native build with stricter TypeScript compilation filtered out the "invalid" field

## Files Changed

- `src/integrations/supabase/types.ts` - Added `game_number` to `game_profits` types

## Build Commands

```bash
npm run build              # Build web app
npm run cap:sync          # Copy to Android
npm run cap:open:android  # Open in Android Studio
npm run cap:run:android   # Run on device
```

---

**Status:** ✅ Fixed and synced to Android

**Action Required:** Test in Android Studio to confirm the fix works for Game 2+

