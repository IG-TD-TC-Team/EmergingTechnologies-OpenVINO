import AsyncStorage from '@react-native-async-storage/async-storage';

const NURSE_NAME_KEY = 'nurse_name';

/**
 * ModeSelectionPresenter
 * MVP Presenter — no React Native imports, pure business logic.
 * The View binds to this via the methods below.
 */
class ModeSelectionPresenter {
  constructor(view) {
    this.view = view;
  }

  async loadNurseName() {
    try {
      const name = await AsyncStorage.getItem(NURSE_NAME_KEY);
      if (name) {
        this.view.setNurseName(name);
      }
    } catch (e) {
      // local storage failure — continue with empty name
    }
  }

  async saveNurseName(name) {
    try {
      await AsyncStorage.setItem(NURSE_NAME_KEY, name.trim());
    } catch (e) {
      // silent — name is UI-only in v1
    }
  }

  onNameChanged(name) {
    this.view.setNurseName(name);
    this.view.setCanStart(name.trim().length > 0);
  }

  async onStartWorking(name, navigation) {
    await this.saveNurseName(name);
    navigation.navigate('Dashboard');
  }

  onFirstSteps() {
    // Future feature — disabled in v1
  }

  onCustomizeSofia() {
    // Future feature — disabled in v1
  }
}

export default ModeSelectionPresenter;
