import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import ModeSelectionPresenter from '../presenters/ModeSelectionPresenter';

// --- Figma icons (SVG inline, CSS vars replaced with literal values) ---

const logoutSvg = `<svg preserveAspectRatio="none" width="100%" height="100%" overflow="visible" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 38H6C4.93913 38 3.92172 37.5786 3.17157 36.8284C2.42143 36.0783 2 35.0609 2 34V6C2 4.93913 2.42143 3.92172 3.17157 3.17157C3.92172 2.42143 4.93913 2 6 2H14M28 30L38 20M38 20L28 10M38 20H14" stroke="#1E1E1E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const helpCircleSvg = `<svg preserveAspectRatio="none" width="100%" height="100%" overflow="visible" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16.18 16C16.6502 14.6633 17.5783 13.5362 18.7999 12.8183C20.0215 12.1003 21.4578 11.8379 22.8544 12.0774C24.2509 12.317 25.5176 13.043 26.4302 14.1271C27.3427 15.2111 27.8421 16.583 27.84 18C27.84 22 21.84 24 21.84 24M22 32H22.02M42 22C42 33.0457 33.0457 42 22 42C10.9543 42 2 33.0457 2 22C2 10.9543 10.9543 2 22 2C33.0457 2 42 10.9543 42 22Z" stroke="#1E1E1E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const briefcaseSvg = `<svg preserveAspectRatio="none" width="100%" height="100%" overflow="visible" viewBox="0 0 44 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 38V6C30 4.93913 29.5786 3.92172 28.8284 3.17157C28.0783 2.42143 27.0609 2 26 2H18C16.9391 2 15.9217 2.42143 15.1716 3.17157C14.4214 3.92172 14 4.93913 14 6V38M6 10H38C40.2091 10 42 11.7909 42 14V34C42 36.2091 40.2091 38 38 38H6C3.79086 38 2 36.2091 2 34V14C2 11.7909 3.79086 10 6 10Z" stroke="#1E1E1E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const settingsSvg = `<svg preserveAspectRatio="none" width="100%" height="100%" overflow="visible" viewBox="0 0 20.1 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M7.3 20L6.9 16.8C6.68333 16.7167 6.47917 16.6167 6.2875 16.5C6.09583 16.3833 5.90833 16.2583 5.725 16.125L2.75 17.375L0 12.625L2.575 10.675C2.55833 10.5583 2.55 10.4458 2.55 10.3375V9.6625C2.55 9.55417 2.55833 9.44167 2.575 9.325L0 7.375L2.75 2.625L5.725 3.875C5.90833 3.74167 6.1 3.61667 6.3 3.5C6.5 3.38333 6.7 3.28333 6.9 3.2L7.3 0H12.8L13.2 3.2C13.4167 3.28333 13.6208 3.38333 13.8125 3.5C14.0042 3.61667 14.1917 3.74167 14.375 3.875L17.35 2.625L20.1 7.375L17.525 9.325C17.5417 9.44167 17.55 9.55417 17.55 9.6625V10.3375C17.55 10.4458 17.5333 10.5583 17.5 10.675L20.075 12.625L17.325 17.375L14.375 16.125C14.1917 16.2583 14 16.3833 13.8 16.5C13.6 16.6167 13.4 16.7167 13.2 16.8L12.8 20H7.3ZM9.05 18H11.025L11.375 15.35C11.8917 15.2167 12.3708 15.0208 12.8125 14.7625C13.2542 14.5042 13.6583 14.1917 14.025 13.825L16.5 14.85L17.475 13.15L15.325 11.525C15.4083 11.2917 15.4667 11.0458 15.5 10.7875C15.5333 10.5292 15.55 10.2667 15.55 10C15.55 9.73333 15.5333 9.47083 15.5 9.2125C15.4667 8.95417 15.4083 8.70833 15.325 8.475L17.475 6.85L16.5 5.15L14.025 6.2C13.6583 5.81667 13.2542 5.49583 12.8125 5.2375C12.3708 4.97917 11.8917 4.78333 11.375 4.65L11.05 2H9.075L8.725 4.65C8.20833 4.78333 7.72917 4.97917 7.2875 5.2375C6.84583 5.49583 6.44167 5.80833 6.075 6.175L3.6 5.15L2.625 6.85L4.775 8.45C4.69167 8.7 4.63333 8.95 4.6 9.2C4.56667 9.45 4.55 9.71667 4.55 10C4.55 10.2667 4.56667 10.525 4.6 10.775C4.63333 11.025 4.69167 11.275 4.775 11.525L2.625 13.15L3.6 14.85L6.075 13.8C6.44167 14.1833 6.84583 14.5042 7.2875 14.7625C7.72917 15.0208 8.20833 15.2167 8.725 15.35L9.05 18ZM10.1 13.5C11.0667 13.5 11.8917 13.1583 12.575 12.475C13.2583 11.7917 13.6 10.9667 13.6 10C13.6 9.03333 13.2583 8.20833 12.575 7.525C11.8917 6.84167 11.0667 6.5 10.1 6.5C9.11667 6.5 8.2875 6.84167 7.6125 7.525C6.9375 8.20833 6.6 9.03333 6.6 10C6.6 10.9667 6.9375 11.7917 7.6125 12.475C8.2875 13.1583 9.11667 13.5 10.1 13.5Z" fill="#1D1B20"/>
</svg>`;

// --- Screen ---

function ModeSelectionScreen({ navigation }) {
  const [nurseName, setNurseName] = useState('');
  const [canStart, setCanStart] = useState(false);

  const presenter = useRef(
    new ModeSelectionPresenter({ setNurseName, setCanStart })
  ).current;

  useEffect(() => {
    presenter.loadNurseName();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* App Bar */}
      <View style={styles.appBar}>
        <TouchableOpacity style={styles.logoutButton} disabled>
          <SvgXml xml={logoutSvg} width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.appBarTitle}>Mode selection</Text>
        <View style={styles.appBarSpacer} />
      </View>

      {/* Name input */}
      <View style={styles.nameSection}>
        <TextInput
          style={styles.nameInput}
          placeholder="Your name"
          placeholderTextColor="#9E9E9E"
          value={nurseName}
          onChangeText={(text) => presenter.onNameChanged(text)}
          returnKeyType="done"
        />
      </View>

      {/* Mode options */}
      <View style={styles.modesContainer}>
        {/* First Steps — disabled, future sprint */}
        <TouchableOpacity style={[styles.modeButton, styles.modeButtonDisabled]} disabled>
          <SvgXml xml={helpCircleSvg} width={48} height={48} />
          <Text style={[styles.modeLabel, styles.modeLabelDisabled]}>First Steps</Text>
        </TouchableOpacity>

        {/* Start working! */}
        <TouchableOpacity
          style={[styles.modeButton, !canStart && styles.modeButtonDisabled]}
          disabled={!canStart}
          onPress={() => presenter.onStartWorking(nurseName, navigation)}
        >
          <SvgXml xml={briefcaseSvg} width={48} height={44} />
          <Text style={[styles.modeLabel, !canStart && styles.modeLabelDisabled]}>
            Start working!
          </Text>
        </TouchableOpacity>

        {/* Customize Sofia */}
        <TouchableOpacity
          style={styles.modeButton}
          onPress={() => presenter.onCustomizeSofia(navigation)}
        >
          <SvgXml xml={settingsSvg} width={48} height={48} />
          <Text style={styles.modeLabel}>Customize Sofia</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#CAC4D0',
  },
  logoutButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.3,
  },
  appBarTitle: {
    fontSize: 22,
    fontWeight: '400',
    color: '#1D1B20',
    textAlign: 'center',
  },
  appBarSpacer: {
    width: 48,
  },
  nameSection: {
    paddingHorizontal: 32,
    paddingTop: 32,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#CAC4D0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1D1B20',
  },
  modesContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 32,
  },
  modeButton: {
    alignItems: 'center',
    gap: 8,
  },
  modeButtonDisabled: {
    opacity: 0.35,
  },
  modeLabel: {
    fontSize: 16,
    color: '#1D1B20',
    borderBottomWidth: 1,
    borderBottomColor: '#CAC4D0',
    paddingBottom: 2,
  },
  modeLabelDisabled: {
    color: '#767676',
  },
});

export default ModeSelectionScreen;
