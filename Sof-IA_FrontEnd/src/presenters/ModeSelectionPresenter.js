import SessionService from '../services/SessionService';

/**
 * ModeSelectionPresenter
 * MVP Presenter — no React Native imports, pure business logic.
 * All session and identity operations go through SessionService.
 */
class ModeSelectionPresenter {
  constructor(view) {
    this.view = view;
  }

  async loadNurseName() {
    try {
      const name = await SessionService.getNurseName();
      if (name) {
        this.view.setNurseName(name);
        this.view.setCanStart(true);
      }
    } catch (e) {
      // Service failure — continue with empty name
    }
  }

  onNameChanged(name) {
    this.view.setNurseName(name);
    this.view.setCanStart(name.trim().length > 0);
  }

  async onStartWorking(name, navigation) {
    try {
      await SessionService.saveNurseName(name);
      await SessionService.startShift(name);
      navigation.navigate('Dashboard');
    } catch (e) {
      // Service failure — navigate anyway, shift state non-critical in v1
      navigation.navigate('Dashboard');
    }
  }

  onFirstSteps() {
    // Future feature — disabled in v1
  }

  onCustomizeSofia(navigation) {
    navigation.navigate('Settings');
  }
}

export default ModeSelectionPresenter;
