import SessionService from '../services/SessionService';

/**
 * LoadingPresenter
 * MVP Presenter — handles the startup routing decision (US #23).
 * Checks for an active shift via SessionService and navigates accordingly.
 * No React Native imports.
 */
class LoadingPresenter {
  constructor(view) {
    this.view = view;
  }

  async checkSessionAndNavigate(navigation) {
    try {
      const hasShift = await SessionService.hasActiveShift();

      if (hasShift) {
        // US #23 — resume active shift, skip Mode Selection
        navigation.replace('Dashboard');
      } else {
        navigation.replace('ModeSelection');
      }
    } catch (e) {
      // Service failure — default to Mode Selection
      navigation.replace('ModeSelection');
    }
  }
}

export default LoadingPresenter;
