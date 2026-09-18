# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Android delivery requirement

After every change that affects `apps/mobile`, rebuild and reinstall the Android
application on the connected ADB device before handing the work back to the
user. Do not rely on an already-installed development build or Metro refresh:
the user must be able to test the exact delivered APK immediately.
