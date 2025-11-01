# 🎯 Your Daily Android Development Workflow

## The Simple Truth

**Android Studio does NOT automatically update when you change code.**

You need to manually tell it to update.

---

## ✅ The One Command You Need

After making ANY changes to your code, run:

```bash
npm run android
```

That's it! This one command will:
1. ✅ Build your web app
2. ✅ Copy it to Android
3. ✅ Tell you it's done

Then in Android Studio, just click Run.

---

## 📋 Step-by-Step Daily Workflow

### When I (or you) make changes to code:

```bash
# 1. In your terminal, run:
npm run android

# Wait for the "✅" message

# 2. In Android Studio:
# - If it's already open, it might auto-detect changes
# - If not, Android Studio will ask to sync
# - Click the green Play button to run
```

### That's literally it!

---

## 🎓 Understanding What Happens

**What `npm run android` does:**

```bash
npm run build          # 1. Compile your React code → creates dist/
npm run cap:sync       # 2. Copy dist/ → android/app/src/main/assets/public/
echo "✅ Done!"        # 3. Tell you it's finished
```

**What Android Studio does:**

- Opens the `android/` folder
- Builds an APK from that folder
- Installs it on your device/emulator
- Runs your app

---

## ⚠️ Important Notes

### Do NOT edit files in `android/app/src/main/assets/public/`

These get **overwritten** every time you run `npm run android`!

**✅ Correct:** Edit files in `src/`  
**❌ Wrong:** Edit files in `android/app/src/main/assets/public/`

### The Android folder is "read-only" to you

You edit: `src/PokerTable.tsx`  
You sync: `npm run android`  
Android gets: Updated files in its project

---

## 🔥 Quick Reference

| Situation | What To Do |
|-----------|------------|
| I made code changes | `npm run android` |
| Android Studio is open | `npm run android` then click Run |
| Android Studio not open | `npm run android` then `npm run cap:open:android` |
| Want to test quickly | `npm run dev` (web browser - faster!) |
| Ready for release | `npm run android` then build APK in Android Studio |

---

## 📝 Example Session

**Morning:**
```bash
# 1. Pull latest changes or work on features
git pull  # or just code

# 2. Test in browser (fast)
npm run dev

# 3. When ready for Android testing
npm run android

# 4. Run in Android Studio
```

**Afternoon (code fix):**
```bash
# 1. Fix a bug in src/PokerTable.tsx

# 2. Update Android
npm run android

# 3. Test in Android Studio
```

**Evening (release):**
```bash
# 1. Final sync
npm run android

# 2. Build release APK in Android Studio
```

---

## ❓ FAQ

**Q: Do I need to close Android Studio?**  
A: No! Just run `npm run android` and it will update.

**Q: Can I set up auto-sync?**  
A: Not recommended. Manual control is better.

**Q: What if `npm run android` fails?**  
A: Try `npm run build` first, then `npm run cap:sync` separately to see the error.

**Q: How do I know Android Studio has the latest code?**  
A: After `npm run android`, check the timestamp on `android/app/src/main/assets/public/index.html`.

---

## 🎯 Remember

**Three things:**
1. Edit code in `src/`
2. Run `npm run android`
3. Run in Android Studio

**That's your entire workflow!**

---

**Pro Tip:** Keep this file open when developing Android features! 📱
