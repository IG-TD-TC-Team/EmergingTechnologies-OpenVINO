import { registerRootComponent } from 'expo';

// Import early so TaskManager.defineTask() is called before registerRootComponent.
// This file is a no-op on web and when expo-task-manager is not yet installed.
import './src/tasks/backgroundQueueSync';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
