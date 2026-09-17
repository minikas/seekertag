const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

// Keyboard Controller 1.21.9 overrides RN's StatusBarManager but only updates
// the Activity window. RN 0.86 also tracks Modal windows, so delegate styling
// to its original manager. Keyboard/inset handling remains in the controller.
const file = resolve(require.resolve('react-native-keyboard-controller/package.json', { paths: [resolve(__dirname, '../apps/mobile')] }), '../android/src/main/java/com/reactnativekeyboardcontroller/modules/statusbar/StatusBarManagerCompatModuleImpl.kt');
const original = `  fun setStyle(style: String) {
    if (!isEnabled()) {
      return original.setStyle(style)
    }

    UiThreadUtil.runOnUiThread {
      getController()?.isAppearanceLightStatusBars = style == "dark-content"
    }
  }`;
const replacement = `  fun setStyle(style: String) {
    // SeekerTag: RN 0.86 synchronizes status bar icons in Activity and Modal windows.
    original.setStyle(style)
  }`;
const source = readFileSync(file, 'utf8');
if (!source.includes(replacement)) {
  if (!source.includes(original)) throw new Error('Review the Keyboard Controller status-bar compatibility patch before building.');
  writeFileSync(file, source.replace(original, replacement));
}
