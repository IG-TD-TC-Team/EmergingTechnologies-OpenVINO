// Pure-JS polyfill for crypto.getRandomValues.
// uuid v13 requires this API; neither react-native-get-random-values nor expo-crypto
// work in Expo Go without a native rebuild. Math.random() is sufficient for local
// SQLite record IDs — the app will never generate enough rows to risk a collision.
if (!globalThis.crypto) {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = (array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}

import { registerRootComponent } from 'expo';

// Import early so TaskManager.defineTask() is called before registerRootComponent.
// This file is a no-op on web and when expo-task-manager is not yet installed.
import './src/tasks/backgroundQueueSync';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
