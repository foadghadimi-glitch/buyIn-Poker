# Database Setup Guide

## Overview
This guide explains the database changes needed to support the updated application and how to apply them.

## Database Changes Required

The application has been updated to use a new database schema that better aligns with poker game requirements. You need to run the following migration to update your database.

## Migration File

A new migration file has been created: `supabase/migrations/20250820000000_fix_schema_and_add_players.sql`

This migration will:
1. Create a `players` table for user profiles
2. Add missing columns to existing tables
3. Create proper indexes for performance
4. Set up RLS policies for the new table
5. Enable realtime subscriptions

## How to Apply the Migration

### Option 1: Using Supabase CLI (Recommended)
```bash
# Navigate to your project directory
cd buyin-blitz

# Apply the migration
supabase db push

# Or if you want to reset and apply all migrations
supabase db reset
```

### Option 2: Manual SQL Execution
1. Open your Supabase dashboard
2. Go to the SQL Editor
3. Copy and paste the contents of the migration file
4. Execute the SQL

### Option 3: Using Supabase Dashboard
1. Go to your Supabase project
2. Navigate to Database → Migrations
3. Upload the migration file
4. Apply the migration

## What the Migration Does

### 1. Players Table
- Creates a new `players` table for user profiles
- Includes: id, name, avatar, created_at, updated_at
- Sets up proper RLS policies for anonymous access

### 2. Table Structure Updates
- Ensures `poker_tables` has both `admin_player_id` and `admin_user_id`
- Ensures `table_players` has both `player_id` and `user_id` for compatibility
- Adds missing columns to `buy_ins` table

### 3. Performance Improvements
- Creates indexes on frequently queried columns
- Enables realtime subscriptions for all tables

### 4. RLS Policies
- Sets up policies that allow anonymous access (no authentication required)
- Enables full CRUD operations on all tables

## Verification

After running the migration, verify that:

1. The `players` table exists and has the correct structure
2. All existing tables have the expected columns
3. You can create and join tables without authentication errors
4. Real-time updates work properly

## Troubleshooting

### Common Issues

1. **Permission Denied**: Make sure you're running the migration as a database owner
2. **Column Already Exists**: The migration uses `IF NOT EXISTS` so this shouldn't be an issue
3. **RLS Policy Conflicts**: The migration drops and recreates policies to avoid conflicts

### If Something Goes Wrong

1. Check the Supabase logs for detailed error messages
2. Verify your database user has the necessary permissions
3. Consider rolling back and running the migration step by step

## Rollback (If Needed)

If you need to rollback the migration:

```sql
-- Drop the players table
DROP TABLE IF EXISTS players;

-- Remove added columns (be careful with this)
ALTER TABLE poker_tables DROP COLUMN IF EXISTS admin_player_id;
ALTER TABLE table_players DROP COLUMN IF EXISTS player_id;

-- Drop indexes
DROP INDEX IF EXISTS idx_table_players_table_id;
DROP INDEX IF EXISTS idx_table_players_player_id;
-- ... etc
```

## Support

If you encounter issues:
1. Check the Supabase documentation
2. Review the migration file for syntax errors
3. Ensure your Supabase version supports all the SQL features used

## Next Steps

After successfully applying the migration:
1. Test the application to ensure it works correctly
2. Monitor the database for any performance issues
3. Consider setting up database backups if you haven't already
