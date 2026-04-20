/**
 * Jest Setup File
 * Configures the test environment before running tests
 */

// Mock React Native components and APIs
jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
    select: jest.fn((obj) => obj.web || obj.default),
  },
  StyleSheet: {
    create: (styles) => styles,
    flatten: (styles) => styles,
  },
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  SafeAreaView: 'SafeAreaView',
  FlatList: function FlatList({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent }) {
    const React = require('react');
    const parts = [];
    if (ListHeaderComponent) {
      const H = typeof ListHeaderComponent === 'function' ? ListHeaderComponent : () => ListHeaderComponent;
      parts.push(React.createElement(H, { key: '__header' }));
    }
    if (data.length === 0 && ListEmptyComponent) {
      const E = typeof ListEmptyComponent === 'function' ? ListEmptyComponent : () => ListEmptyComponent;
      parts.push(React.createElement(E, { key: '__empty' }));
    }
    (data || []).forEach((item, index) => {
      if (renderItem) parts.push(renderItem({ item, index }));
    });
    return React.createElement('View', { testID: 'flatlist' }, ...parts);
  },
  Modal: 'Modal',
  Pressable: 'Pressable',
  Switch: 'Switch',
  Alert: {
    alert: jest.fn(),
  },
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: jest.fn(function (val) {
      this._value = val;
      this.setValue   = jest.fn((v) => { this._value = v; });
      this.interpolate = jest.fn((cfg) => cfg.outputRange ? cfg.outputRange[0] : 0);
    }),
    timing:   jest.fn(() => ({ start: jest.fn() })),
    loop:     jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    sequence: jest.fn((anims) => ({ start: jest.fn() })),
    parallel: jest.fn((anims) => ({ start: jest.fn() })),
    View: 'Animated.View',
    Text: 'Animated.Text',
  },
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

// Setup fake-indexeddb for web adapter tests
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

// Mock expo-sqlite for native adapter tests
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  openDatabaseSync: jest.fn(),
}));

// Mock ContinuousRecordingService and its native transitive dependencies
// (expo-av, expo-file-system, ChunkUploadService) so presenter unit tests stay fast and portable.
jest.mock('./src/services/audio/ContinuousRecordingService', () => ({
  toggleRecording: jest.fn(),
  subscribe: jest.fn(() => jest.fn()),
  unsubscribe: jest.fn(),
  isRecording: jest.fn().mockReturnValue(false),
  stop: jest.fn(),
}));

// Mock react-native-svg
jest.mock('react-native-svg', () => ({
  SvgXml: 'SvgXml',
  Svg: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
}));

// Suppress console logs during tests (optional)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set test timeout
jest.setTimeout(10000);
