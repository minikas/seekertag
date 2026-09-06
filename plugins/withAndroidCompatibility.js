const { withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

/** Local builds need HTTP to reach the developer's LAN API. Disable for HTTPS deployments. */
module.exports = function withAndroidCompatibility(config, { allowCleartext = false } = {}) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw new Error('SeekerTag: Android application manifest was not generated.');
    application.$['android:usesCleartextTraffic'] = String(allowCleartext);
    return mod;
  });
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
