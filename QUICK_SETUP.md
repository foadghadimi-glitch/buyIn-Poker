# 🚀 Quick Database Setup Guide

## ⚠️ **IMPORTANT: You Need to Reset Your Database**

The error you're getting (`Could not find the 'admin_user_id' column`) means your current database schema doesn't match what the application expects. Here's how to fix it:

## 🔥 **Option 1: Complete Reset (Recommended)**

1. **Go to your Supabase Dashboard**
2. **Navigate to SQL Editor**
3. **Copy and paste this entire script:**

```sql
-- Copy the contents of: supabase/migrations/20250820000002_simplified_schema.sql
```

4. **Click "Run"**
5. **Wait for completion**

## 🔧 **Option 2: Using Supabase CLI**

```bash
cd buyin-blitz
supabase db reset
```

## 📋 **What This Will Do:**

✅ **Drop all existing tables** (bye-bye old schema!)  
✅ **Create clean, simple tables** with correct structure  
✅ **Set up proper RLS policies** for anonymous access  
✅ **Enable realtime subscriptions** for live updates  
✅ **Create performance indexes**  
✅ **Grant proper permissions**  

## 🎯 **New Schema Structure:**

- `players` - User profiles (id, name, avatar)
- `poker_tables` - Game tables (id, name, join_code, admin_player_id)
- `table_players` - Players in tables (table_id, player_id, status)
- `buy_ins` - Buy-in transactions
- `buy_in_requests` - Buy-in requests
- `join_requests` - Join table requests
- `table_endups` - Final amounts

## 🚨 **What You'll Lose:**

- All existing data
- All existing tables
- All existing policies

## ✅ **What You'll Gain:**

- Clean, working database
- No more column errors
- Proper RLS policies
- Realtime functionality
- Performance indexes

## 🧪 **Test After Setup:**

1. **Create a new player profile**
2. **Create a new table**
3. **Join the table**
4. **Verify everything works**

## 🆘 **If Something Goes Wrong:**

1. Check Supabase logs for error messages
2. Ensure you have database owner permissions
3. Try running the script in smaller chunks
4. Contact support if needed

## 🎉 **After Success:**

Your app should work perfectly with:
- ✅ No more database errors
- ✅ Beautiful poker-themed UI
- ✅ Working real-time updates
- ✅ Proper type safety

---

**Ready to fix this once and for all? Run the simplified schema script!** 🚀
