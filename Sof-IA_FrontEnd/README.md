# Sof-IA FrontEnd

A mobile application built with **React Native** and **Expo**.

---

## What is React Native?

React Native lets you build mobile apps using JavaScript and React.
Instead of HTML elements like `<div>` or `<p>`, you use mobile components like `<View>` and `<Text>`.

Your code runs on **iOS** and **Android** from a single codebase.

---

## What is Expo?

Expo is a set of tools built on top of React Native that makes development easier:
- No need to install Android Studio or Xcode to get started
- Scan a QR code with the **Expo Go** app to see your app live on your phone
- Provides ready-to-use APIs (camera, location, notifications, etc.)

---

## Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Start the development server
```bash
npx expo start
```

### 3. Open on your device
- Install **Expo Go** on your phone (Android / iOS)
- Scan the QR code shown in the terminal

### 4. Or run on an emulator
```bash
npm run android   # Android emulator
npm run web       # Browser
```

> **Note:** To run on web, you need to install extra dependencies first:
> ```bash
> npx expo install react-dom react-native-web
> ```
> Then run `npm run web` again.

---

## Project Structure

```
Sof-IA_FrontEnd/
├── App.js          # Entry point — your first screen
├── assets/         # Images, icons, fonts
├── app.json        # App configuration (name, icon, splash screen)
└── package.json    # Dependencies and scripts
```

---

## Core Components

| Component | HTML equivalent | Description |
|---|---|---|
| `<View>` | `<div>` | Container / layout box |
| `<Text>` | `<p>` / `<span>` | Display text |
| `<Image>` | `<img>` | Display images |
| `<TextInput>` | `<input>` | Text input field |
| `<TouchableOpacity>` | `<button>` | Pressable element |
| `<ScrollView>` | `<div style="overflow:scroll">` | Scrollable container |
| `<FlatList>` | — | Optimized list for large data |

---

## Styling

React Native uses JavaScript objects for styles (no CSS files):

```js
import { StyleSheet, View, Text } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello World</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
});
```

Key differences from CSS:
- Property names are **camelCase** (`backgroundColor` not `background-color`)
- Values are strings or numbers (`fontSize: 24` not `font-size: 24px`)
- Layout uses **Flexbox** by default

---

## Navigation

Install React Navigation to move between screens:

```bash
npm install @react-navigation/native
npx expo install react-native-screens react-native-safe-area-context
npm install @react-navigation/stack
```

Basic usage:
```js
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Details" component={DetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

---

## Useful Expo APIs

| Package | What it does |
|---|---|
| `expo-camera` | Access device camera |
| `expo-location` | Get GPS location |
| `expo-image-picker` | Pick images from gallery |
| `expo-notifications` | Push notifications |
| `expo-async-storage` | Save data locally |
| `expo-font` | Load custom fonts |

Install any of them with:
```bash
npx expo install expo-camera
```

---

## Useful Links

- [React Native Docs](https://reactnative.dev/docs/getting-started)
- [Expo Docs](https://docs.expo.dev)
- [React Navigation](https://reactnavigation.org)
- [Expo SDK API Reference](https://docs.expo.dev/versions/latest/)