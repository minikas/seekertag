const { withAndroidManifest, withAndroidStyles, withAppBuildGradle } = require('@expo/config-plugins');

/** Local builds need HTTP to reach the developer's LAN API. Disable for HTTPS deployments. */
module.exports = function withAndroidCompatibility(config, { allowCleartext = false, darkSplash = false } = {}) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw new Error('SeekerTag: Android application manifest was not generated.');
    application.$['android:usesCleartextTraffic'] = String(allowCleartext);
    return mod;
  });
  if (darkSplash) {
    // The AndroidX starting theme follows the device's appearance before
    // expo-system-ui locks the app to dark. Keep the launch bars dark too.
    // Register this plugin before expo-splash-screen: Android style mods run
    // in reverse registration order, and the splash plugin replaces the style.
    config = withAndroidStyles(config, (mod) => {
      const splash = mod.modResults.resources.style?.find(({ $ }) => $.name === 'Theme.App.SplashScreen');
      if (!splash) throw new Error('SeekerTag: Android splash theme was not generated.');
      const items = {
        'android:statusBarColor': '@color/splashscreen_background',
        'android:navigationBarColor': '@color/splashscreen_background',
        'android:windowLightStatusBar': 'false',
        'android:windowLightNavigationBar': 'false',
        'android:enforceNavigationBarContrast': 'false',
      };
      splash.item = (splash.item || []).filter(({ $ }) => !Object.hasOwn(items, $.name));
      splash.item.push(...Object.entries(items).map(([name, value]) => ({ $: { name }, _: value })));
      return mod;
    });
  }
  // Expo 57 limits CMake with reactNativeArchitectures but still packages every
  // ABI from dependencies unless the application explicitly filters them too.
  return withAppBuildGradle(config, (mod) => {
    const marker = '// SeekerTag: package only the requested device architectures.';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        ${marker}\n        ndk { abiFilters.addAll((findProperty('reactNativeArchitectures') ?: 'arm64-v8a').split(',').toList()) }`
      );
    }
    return mod;
  });
};
