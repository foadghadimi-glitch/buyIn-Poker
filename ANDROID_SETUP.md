# 📱 Android Setup Guide for Buy In Blitz

This guide will walk you through building and running your Buy In Blitz web app as an Android application using Capacitor.

## ✅ Prerequisites

Before you begin, make sure you have the following installed:

1. **Node.js** (v16 or higher) - Already installed ✓
2. **Java Development Kit (JDK)** - Version 17 or higher
3. **Android Studio** - Latest stable version
4. **Android SDK** - Installed via Android Studio

### Installing Prerequisites

#### 1. Install Java Development Kit (JDK 17+)

**macOS:**
```bash
# Using Homebrew
brew install openjdk@17

# Add to your PATH (add to ~/.zshrc or ~/.bash_profile)
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Linux:**
```bash
sudo apt-get update
sudo apt-get install openjdk-17-jdk
```

**Windows:**
Download and install from: https://adoptium.net/

#### 2. Install Android Studio

1. Download from: https://developer.android.com/studio
2. Install the IDE
3. During setup, install:
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device (AVD) - for emulator

#### 3. Configure Android SDK

1. Open Android Studio
2. Go to **Tools → SDK Manager**
3. Install:
   - **SDK Platforms**: Android 14.0 (API 34)
   - **SDK Tools**: 
     - Android SDK Build-Tools
     - Android Emulator
     - Android SDK Platform-Tools
     - Intel x86 Emulator Accelerator (if on Intel Macs)

#### 4. Set Environment Variables

Add these to your shell profile (`~/.zshrc` or `~/.bash_profile`):

**macOS/Linux:**
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
# OR
# export ANDROID_HOME=$HOME/Android/Sdk  # Linux

export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
```

**Windows:**
```powershell
# Add to System Environment Variables
ANDROID_HOME=C:\Users\YourName\AppData\Local\Android\Sdk

# Add to PATH
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\tools
%ANDROID_HOME%\tools\bin
%ANDROID_HOME%\emulator
```

## 🚀 Building Your Android App

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Build the Web App

```bash
npm run build
```

This creates an optimized production build in the `dist` folder.

### Step 3: Sync with Capacitor

```bash
npm run cap:sync
```

This copies your built web app to the Android project and updates native dependencies.

### Step 4: Open in Android Studio

```bash
npm run cap:open:android
```

This opens your project in Android Studio.

## 📦 Creating an APK (Android Package)

### Option A: Using Android Studio (Recommended for Testing)

1. Open the project in Android Studio
2. Wait for Gradle sync to complete
3. Go to **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. Wait for the build to complete
5. Click "locate" in the notification to find your APK
6. APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

### Option B: Using Command Line

```bash
cd android
./gradlew assembleDebug
```

The APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

## 📱 Installing on Your Phone

### Method 1: USB Debugging

1. Enable Developer Options on your Android phone:
   - Go to **Settings → About Phone**
   - Tap **Build Number** 7 times
2. Enable USB Debugging:
   - Go to **Settings → Developer Options**
   - Enable **USB Debugging**
3. Connect your phone via USB
4. Run:
   ```bash
   npm run cap:run:android
   ```
   Or in Android Studio, click the green **Run** button

### Method 2: Install APK Directly

1. Transfer the APK file to your phone (via email, cloud storage, etc.)
2. On your phone, enable **Install from Unknown Sources**
3. Open the APK file and tap **Install**

## 🔨 Development Workflow

### During Development:

```bash
# 1. Make changes to your React code
# 2. Build the web app
npm run build

# 3. Sync changes to Android
npm run cap:sync

# 4. Test in Android Studio or on device
npm run cap:open:android
```

### Hot Reload (Live Reload):

For development, you can use Capacitor's live reload:

```bash
# Start a local server
npm run dev

# In capacitor.config.ts, set:
# server: { url: "http://YOUR_IP:8080" }

# Run on device
npm run cap:run:android
```

## 🏗️ Building a Release APK

For production release:

1. Edit `android/app/build.gradle`:
```gradle
android {
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

2. Create a keystore (first time only):
```bash
cd android/app
keytool -genkey -v -keystore buyinblitz-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias buyinblitz
```

3. Create `android/key.properties`:
```
storePassword=your-store-password
keyPassword=your-key-password
keyAlias=buyinblitz
storeFile=buyinblitz-release-key.jks
```

4. Update `android/app/build.gradle` to use the keystore

5. Build release APK:
```bash
cd android
./gradlew assembleRelease
```

## 🔧 Configuration Files

### Main Configuration
- `capacitor.config.ts` - App ID, name, and Capacitor settings
- `package.json` - Dependencies and build scripts
- `android/app/build.gradle` - Android build configuration
- `android/app/src/main/AndroidManifest.xml` - App permissions and metadata

### Key Settings

**App ID:** `com.buyinblitz.app` (in capacitor.config.ts)
**App Name:** Buy In Blitz
**Package Name:** com.buyinblitz.app

## 🐛 Troubleshooting

### "JAVA_HOME not set"
```bash
export JAVA_HOME=$(/usr/libexec/java_home)
```

### "Command not found: android"
Install Android SDK Platform-Tools

### "Gradle sync failed"
1. Clear Gradle cache: `cd android && ./gradlew clean`
2. In Android Studio: **File → Invalidate Caches → Invalidate and Restart**

### "App not loading"
1. Check internet permissions in AndroidManifest.xml
2. Verify Supabase URL is accessible
3. Check browser console logs

### Build Errors
```bash
# Clean everything
cd android
./gradlew clean

# Rebuild
./gradlew assembleDebug
```

## 📝 Next Steps

- [ ] Set up app icons and splash screens
- [ ] Configure push notifications (optional)
- [ ] Set up Google Play Store account
- [ ] Prepare screenshots and app description
- [ ] Create signing key for release builds
- [ ] Upload to Play Store

## 🎉 Success!

Your Android app is ready! The web app is now packaged as a native Android application.

**Quick Commands Summary:**
```bash
npm run build              # Build web app
npm run cap:sync          # Sync to Android
npm run cap:open:android  # Open in Android Studio
npm run cap:run:android   # Run on connected device
```

## 📚 Additional Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Android Developer Guide](https://developer.android.com/)
- [React Best Practices](https://react.dev/learn)

---

**Need Help?** Check the Capacitor docs or open an issue on GitHub.

