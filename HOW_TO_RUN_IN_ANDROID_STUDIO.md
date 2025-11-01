# 🎯 How to Run Your Android App in Android Studio

## ✅ Simple 3-Step Process

### Step 1: Open Android Studio
If it's not already open, Android Studio should have just launched with your project.

**If Android Studio didn't open automatically:**
```bash
# Run this command in your terminal:
npm run cap:open:android
```

Or manually open:
- File → Open
- Navigate to: `/Users/foadghadimi/Cursor_Projects/buyin-blitz/android`
- Click "Open"

### Step 2: Wait for Gradle Sync
- Android Studio will automatically sync Gradle (downloads dependencies)
- Look at the bottom status bar - it will say "Gradle Sync" or "Indexing"
- **Wait for this to finish** - first time can take 5-10 minutes
- You'll see "Gradle build finished" when it's done

### Step 3: Run the App
**Option A: Using an Android Emulator**
1. Top toolbar: Click the green **Play button** ▶️ (or press `Ctrl+R` / `Cmd+R`)
2. If you don't have an emulator, click "No devices" → "AVD Manager" → Create Virtual Device
3. Choose a device (e.g., Pixel 5) → Next → Download API 34 → Finish

**Option B: Using Your Physical Android Phone**
1. Enable Developer Mode:
   - Settings → About Phone → Tap "Build Number" 7 times
2. Enable USB Debugging:
   - Settings → Developer Options → Enable "USB Debugging"
3. Connect your phone via USB
4. In Android Studio, select your device from the dropdown
5. Click the green **Play button** ▶️

## 🎉 That's It!

Your app will build, install, and launch on your device/emulator!

---

## 🔄 When You Make Code Changes

Every time you change your React code, you need to rebuild and sync:

```bash
# 1. Build your web app
npm run build

# 2. Sync to Android
npm run cap:sync

# 3. In Android Studio, click Run again (or just click Run without steps 1-2 if you only changed native code)
```

Or use the shortcut script:
```bash
# I'll create this for you in the next section!
```

---

## 📱 What You Should See

When the app launches, you'll see:
- App name: **Buy In Blitz**
- Icon: Default Capacitor icon (you can customize this later)
- Full React web app running as a native Android app
- All your Supabase functionality working

---

## ❗ Troubleshooting

### "Gradle Sync Failed"
**Solution:**
```bash
cd android
./gradlew clean
```
Then in Android Studio: File → Sync Project with Gradle Files

### "SDK not found"
**Solution:**
1. Tools → SDK Manager
2. Install Android 14.0 (API 34)
3. Install Android SDK Build-Tools
4. Apply → Ok

### "No devices found"
**Solution:**
1. Tools → Device Manager
2. Create Virtual Device
3. Follow the wizard

### "Execution failed for task ':app:compileDebugJavaWithJavac'"
**Solution:** Install JDK 17+
```bash
brew install openjdk@17
```

---

## 📂 Which Folder to Use?

**USE THIS:** `android/` (in your main project folder)

**IGNORE THIS:** `mobile/` (old/unused folder, you can delete it later)

---

## 🎯 Quick Reference

**Open in Android Studio:**
```bash
npm run cap:open:android
```

**Rebuild after code changes:**
```bash
npm run build && npm run cap:sync
```

**Just the commands you need:**
```bash
npm run cap:open:android    # Open in Android Studio
npm run cap:sync           # Sync web code to Android
```

---

**Need help?** The app is ready to run - just click that green play button in Android Studio! 🚀

