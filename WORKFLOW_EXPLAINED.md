# 🔄 Android Development Workflow Explained

## How Changes Flow from Code to Android Studio

### ❌ INCORRECT Understanding

**NOT:** "Auto-update when I change code" ❌

The `android/` folder is a **snapshot** of your built web app, not a live sync.

---

## ✅ CORRECT Understanding

### The Two-Part System

Your project has TWO parts:

```
buyin-blitz/
├── src/              ← Your React code (you edit this)
├── dist/             ← Built web app (Vite creates this)
├── android/          ← Android Studio project (uses dist/)
│   └── app/src/main/assets/public/  ← Copy of dist/
└── package.json
```

### The Workflow Steps

**When you change code:**

1. **Edit code** in `src/` (React, TypeScript, etc.)
2. **Build** → Vite compiles your code → Creates `dist/`
3. **Sync** → Capacitor copies `dist/` → Into `android/`
4. **Android Studio** → Opens `android/` folder

---

## 🛠️ Correct Workflow

### Option 1: Manual (When You Make Changes)

```bash
# 1. Make changes to your React code in src/

# 2. Build the web app
npm run build

# 3. Copy to Android
npm run cap:sync

# 4. In Android Studio, click "Sync Project with Gradle Files" or just Run
```

### Option 2: One-Command (Recommended)

```bash
# Do steps 2 and 3 together
npm run build && npm run cap:sync

# Then in Android Studio, click Run
```

---

## ⚠️ Important Points

### 1. Android Studio DOES NOT Auto-Update

- **Not automatic:** Changes to `src/` do NOT appear in Android Studio automatically
- **Android Studio** reads from the `android/app/src/main/assets/public/` folder
- **This folder** only updates when you run `npm run cap:sync`

### 2. The Android Folder Structure

```
android/
├── app/
│   ├── build.gradle                    ← Never changes manually
│   ├── src/
│   │   ├── main/
│   │   │   ├── Java files             ← Never changes manually
│   │   │   ├── AndroidManifest.xml    ← Never changes manually
│   │   │   └── assets/
│   │   │       └── public/            ← THIS gets overwritten by cap:sync
│   └── build/                          ← Build artifacts (ignore)
├── build.gradle                        ← Never changes manually
└── settings.gradle                     ← Never changes manually
```

**Key Understanding:** The `assets/public/` folder is where your React app lives in Android, and it gets **overwritten** every time you run `cap:sync`.

---

## 🎯 Recommended Daily Workflow

### When You're Actively Developing:

```bash
# In your terminal:

# 1. Make code changes in src/

# 2. Build and sync (one command)
npm run build && npm run cap:sync

# 3. In Android Studio:
#    - The sync happens automatically OR
#    - Click "File > Sync Project with Gradle Files"
#    - Click the green Play button to run
```

### If Android Studio is Already Open:

1. Run `npm run build && npm run cap:sync` in terminal
2. Android Studio will detect file changes
3. It might auto-reload, or you might need to click "Sync"
4. Click Run

---

## 🔥 Pro Tips

### Tip 1: Watch for "Sync" Messages

After running `cap:sync`, you'll see:
```
✔ Copying web assets from dist to android/app/src/main/assets/public
```

This confirms your changes are copied.

### Tip 2: Create a Shortcut Script

Add to `package.json`:
```json
"scripts": {
  "android": "npm run build && npm run cap:sync && echo '✅ Ready for Android Studio'"
}
```

Then just run:
```bash
npm run android
```

### Tip 3: Use Hot Reload for Development

For active development, don't use Android. Instead:
```bash
npm run dev
```

Then open http://localhost:8080 in your browser. Much faster!

Only use Android when:
- Testing native features
- Testing on real device
- Preparing for release

---

## 📋 Summary Table

| What You Do | What Happens | Android Studio Sees It? |
|-------------|--------------|------------------------|
| Edit `src/PokerTable.tsx` | Nothing | ❌ No |
| Run `npm run build` | Creates `dist/` | ❌ No |
| Run `npm run cap:sync` | Copies `dist/` → `android/` | ✅ Yes! |
| Click Run in Android Studio | Builds APK, runs app | - |

---

## ❓ Common Questions

**Q: Can I edit files in android/app/src/main/assets/public/?**  
A: ❌ NO! They get overwritten by `cap:sync`. Always edit `src/` instead.

**Q: How do I know if Android Studio has the latest code?**  
A: Check the timestamp on `android/app/src/main/assets/public/index.html` after running `cap:sync`.

**Q: What if I only change a small thing?**  
A: Still need to run `npm run build && npm run cap:sync`.

**Q: Can I set up auto-sync?**  
A: Not recommended. Manual control is better to avoid syncing broken builds.

---

## ✅ Your Understanding Checklist

- [x] Changes to `src/` don't automatically appear in Android Studio
- [x] Need to run `npm run build` first
- [x] Need to run `npm run cap:sync` to copy to Android
- [x] Then Android Studio can use the updated files
- [x] The `android/` folder structure stays mostly the same
- [x] Only `assets/public/` gets updated by sync

---

**TL;DR:** Edit code → `npm run build && npm run cap:sync` → Android Studio sees changes ✅

