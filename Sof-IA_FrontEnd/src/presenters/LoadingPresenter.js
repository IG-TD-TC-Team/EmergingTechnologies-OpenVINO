import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_SHIFT_KEY = 'active_shift';
const NURSE_NAME_KEY = 'nurse_name';

/**
 * LoadingPresenter
 * MVP Presenter — handles the startup routing decision (US #23).
 * Checks for an active shift and navigates accordingly.
 * No React Native imports.
 */
class LoadingPresenter {
  constructor(view) {
    this.view = view;
  }

  async checkSessionAndNavigate(navigation) {
    try {
      const [activeShift, nurseName] = await Promise.all([
        AsyncStorage.getItem(ACTIVE_SHIFT_KEY),
        AsyncStorage.getItem(NURSE_NAME_KEY),
      ]);

      if (activeShift) {
        // US #23 — resume active shift, skip Mode Selection
        navigation.replace('Dashboard');
      } else {
        navigation.replace('ModeSelection');
      }
    } catch (e) {
      // Storage failure — default to Mode Selection
      navigation.replace('ModeSelection');
    }
  }
}

export default LoadingPresenter;
