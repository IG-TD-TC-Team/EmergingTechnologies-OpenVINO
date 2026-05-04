import { NavigationContainer } from '@react-navigation/native';
import { CardStyleInterpolators, createStackNavigator } from '@react-navigation/stack';
import React from 'react';
import { Platform } from 'react-native';
import BedDetailScreen from '../screens/BedDetailScreen';
import CardDetailScreen from '../screens/CardDetailScreen';
import DashboardScreen from '../screens/DashboardScreen';
import EditPatientScreen from '../screens/EditPatientScreen';
import LoadingScreen from '../screens/LoadingScreen';
import ModeSelectionScreen from '../screens/ModeSelectionScreen';

const Stack = createStackNavigator();

// Slide-left on open, slide-right on close, ≤ 280 ms.
// gestureEnabled stays on for native (swipe-right back gesture) and is
// disabled on web where the gesture API is not available.
const SLIDE_OPTIONS = {
  cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
  transitionSpec: {
    open:  { animation: 'timing', config: { duration: 280 } },
    close: { animation: 'timing', config: { duration: 280 } },
  },
  gestureEnabled:   Platform.OS !== 'web',
  gestureDirection: 'horizontal',
};

function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Loading"       component={LoadingScreen} />
        <Stack.Screen name="ModeSelection" component={ModeSelectionScreen} />
        <Stack.Screen name="Dashboard"     component={DashboardScreen} />
        <Stack.Screen name="BedDetails"    component={BedDetailScreen}  options={SLIDE_OPTIONS} />
        <Stack.Screen name="CardDetail"    component={CardDetailScreen}  options={SLIDE_OPTIONS} />
        <Stack.Screen name="EditPatient"   component={EditPatientScreen} options={SLIDE_OPTIONS} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default AppNavigator;
