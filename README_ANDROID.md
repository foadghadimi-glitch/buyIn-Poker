# 🤖 Buy In Blitz - Android App

Your React web app is now configured to run as a native Android application using Capacitor!

## ✅ What's Been Done

- ✅ Capacitor configured with app ID: `com.buyinblitz.app`
- ✅ Android platform added and configured
- ✅ Build scripts added to `package.json`
- ✅ App name set to "Buy In Blitz"
- ✅ All web assets properly synced to Android
- ✅ Internet permissions configured for Supabase connectivity

## 📁 Project Structure

```
buyin-blitz/
├── src/                       # Your React source code
├── public/                    # Public assets (icons, images)
├── android/                   # Native Android project
│   ├── app/
│   │   ├── build.gradle      # Android build config
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/com/buyinblitz/app/MainActivity.java
│   │       └── assets/public/ # Your web app (synced from dist/)
│   └── build.gradle           # Root build config
├── dist/                      # Built web app (input for Android)
├── capacitor.config.ts        # Capacitor configuration
└── package.json               # Dependencies & scripts
```

## 🚀 Quick Start

### Option 1: Using Android Studio (Recommended)

```bash
# Build and sync
npm run build && npm run cap:sync

# Open in Android Studio
npm run cap:open:android

# Click the green "Run" button in Android Studio
```

### Option 2: Build APK Directly

```bash
# Build the web app
npm run build

# Sync to Android
npm run cap:sync

# Build APK
cd android
./gradlew assembleDebug

# APK is at: android/app/build/outputs/apk/debug/app-debug.apk
```

## 📱 Installation on Device

### Via USB (with USB debugging enabled):

```bash
npm run cap:run:android
```

### Via APK:

1. Build debug APK (see above)
2. Transfer APK to your phone
3. Enable "Install from Unknown Sources"
4. Open APK and install

## 🔧 Available Scripts

```bash
npm run dev                    # Start web dev server
npm run build                  # Build production web app
npm run cap:sync              # Sync web → Android
npm run cap:open:android      # Open in Android Studio
npm run cap:run:android       # Build & install on device
```

## 🏗️ Build Process

1. **Web Build**: React app compiles to `dist/`
2. **Capacitor Sync**: Copies `dist/` to `android/app/src/main/assets/public/`
3. **Native Build**: Gradle packages web assets into APK
4. **Install**: APK installed on device/emulator

## 🔑 Key Configuration Files

### `capacitor.config.ts`
- App ID: `com.buyinblitz.app`
- App Name: Buy In Blitz
- Web Directory: `dist`

### `android/app/build.gradle`
- Package: `com.buyinblitz.app`
- Min SDK: 22 (Android 5.1)
- Target SDK: 34 (Android 14)

### `android/app/src/main/AndroidManifest.xml`
- Internet permissions for Supabase
- MainActivity configuration
- App theme and icons

## 🌐 Network Configuration

Your app is configured to work with:
- ✅ Supabase backend (HTTPS)
- ✅ Internet access enabled
- ✅ Mixed content allowed

## 📚 Next Steps

### For Development:
1. Install Android Studio
2. Set up an emulator or connect your phone
3. Run `npm run cap:open:android`
4. Make changes, rebuild, and sync

### For Production:
1. Create a release keystore
2. Configure signing in `build.gradle`
3. Build release APK/AAB
4. Submit to Google Play Store

## 📖 Documentation

- **Quick Start**: [QUICK_ANDROID_START.md](QUICK_ANDROID_START.md)
- **Full Setup**: [ANDROID_SETUP.md](ANDROID_SETUP.md)
- **Capacitor Docs**: https://capacitorjs.com/docs
- **Android Docs**: https://developer.android.com/

## 🐛 Troubleshooting

### Gradle Sync Issues
```bash
cd android
./gradlew clean
./gradlew sync
```

### Java Version Problems
Ensure Java 17+ is installed and JAVA_HOME is set.

### Connection Issues
Verify Supabase URL is accessible and CORS is configured.

### Missing Assets
Run `npm run build && npm run cap:sync` to regenerate.

## 🎉 Success!

Your React web app is now a native Android application!

**Test it:**
1. Build: `npm run build && npm run cap:sync`
2. Open: `npm run cap:open:android`
3. Run: Click the green play button in Android Studio

**Questions?** Check the docs or open an issue!

