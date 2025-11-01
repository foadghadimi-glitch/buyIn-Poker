# 🚀 Quick Start: Build Your Android App

Follow these steps to build and install your Buy In Blitz Android app:

## ⚡ Fast Setup (if you have Android Studio installed)

```bash
# 1. Install dependencies
npm install

# 2. Build the web app
npm run build

# 3. Sync with Android
npm run cap:sync

# 4. Open in Android Studio
npm run cap:open:android

# 5. Click the green "Run" button or press Ctrl+R
```

That's it! Your app will install on your connected device or emulator.

## 📱 First Time Setup

If you don't have Android Studio yet:

### 1. Install Android Studio
- Download: https://developer.android.com/studio
- Install with default settings
- Open and complete the setup wizard

### 2. Install Android SDK
- In Android Studio: **Tools → SDK Manager**
- Check: **Android 14.0 (API 34)**
- Click **Apply**

### 3. Set up Android Emulator (Optional)
- In Android Studio: **Tools → Device Manager**
- Click **Create Device**
- Select a device (e.g., Pixel 5)
- Select **API 34** system image
- Click **Finish**

### 4. Enable Developer Mode on Your Phone
1. Go to **Settings → About Phone**
2. Tap **Build Number** 7 times
3. Go to **Developer Options**
4. Enable **USB Debugging**

## 🔨 Build Your First APK

```bash
# Build debug APK (for testing)
cd android
./gradlew assembleDebug

# APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

Transfer this APK to your phone and install it!

## 🎯 Common Commands

```bash
npm run build              # Build web app
npm run cap:sync          # Copy web assets to Android
npm run cap:open:android  # Open in Android Studio
npm run cap:run:android   # Run on device/emulator
```

## ❗ Troubleshooting

**"Command not found: cap"**
```bash
npm install -g @capacitor/cli
```

**"Gradle sync failed"**
```bash
cd android
./gradlew clean
```

**"Java version error"**
- Install JDK 17 or higher
- Set JAVA_HOME environment variable

## 📖 Full Documentation

For detailed setup and configuration, see [ANDROID_SETUP.md](ANDROID_SETUP.md)

---

**Ready to ship?** Build, test, and install your app! 🎉

