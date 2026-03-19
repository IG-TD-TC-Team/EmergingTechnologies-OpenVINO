import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import LoadingPresenter from '../presenters/LoadingPresenter';

const sofiaLogo = require('../../assets/icons/sofia-logo.png');

function LoadingScreen({ navigation }) {
  const presenter = useRef(new LoadingPresenter({})).current;

  useEffect(() => {
    // Brief splash display before routing decision
    const timer = setTimeout(() => {
      presenter.checkSessionAndNavigate(navigation);
    }, 1800);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.logoCircle}>
        <Image source={sofiaLogo} style={styles.logo} resizeMode="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCircle: {
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#E1E3F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 220,
    height: 220,
  },
});

export default LoadingScreen;
