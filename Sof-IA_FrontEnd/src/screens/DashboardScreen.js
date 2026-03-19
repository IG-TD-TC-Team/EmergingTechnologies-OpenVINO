import React from 'react';
import { SafeAreaView, StyleSheet, Text } from 'react-native';

// Placeholder — will be implemented in a future sprint (US #4)
function DashboardScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Dashboard — coming soon</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    color: '#1D1B20',
  },
});

export default DashboardScreen;
