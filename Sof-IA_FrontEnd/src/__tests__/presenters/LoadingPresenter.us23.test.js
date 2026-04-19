/**
 * LoadingPresenter — US23: Auto-resume active shift on app launch
 *
 * Tests:
 *   - hasActiveShift → true  → navigate to Dashboard with { resumed: true }
 *   - hasActiveShift → false → navigate to ModeSelection
 *   - SessionService throws  → fall back to ModeSelection
 */

jest.mock('../../services/SessionService', () => ({
  __esModule: true,
  default: {
    hasActiveShift: jest.fn(),
  },
}));

import LoadingPresenter from '../../presenters/LoadingPresenter';
import SessionService from '../../services/SessionService';

function makeNavigation() {
  return { replace: jest.fn() };
}

describe('LoadingPresenter — US23 session resume', () => {
  let presenter;
  let navigation;

  beforeEach(() => {
    jest.clearAllMocks();
    navigation = makeNavigation();
    presenter = new LoadingPresenter({});
  });

  it('navigates to Dashboard with resumed:true when an active shift exists', async () => {
    SessionService.hasActiveShift.mockResolvedValue(true);
    await presenter.checkSessionAndNavigate(navigation);
    expect(navigation.replace).toHaveBeenCalledWith('Dashboard', { resumed: true });
  });

  it('navigates to ModeSelection when no active shift', async () => {
    SessionService.hasActiveShift.mockResolvedValue(false);
    await presenter.checkSessionAndNavigate(navigation);
    expect(navigation.replace).toHaveBeenCalledWith('ModeSelection');
  });

  it('falls back to ModeSelection when SessionService throws', async () => {
    SessionService.hasActiveShift.mockRejectedValue(new Error('DB error'));
    await presenter.checkSessionAndNavigate(navigation);
    expect(navigation.replace).toHaveBeenCalledWith('ModeSelection');
  });

  it('does not navigate to Dashboard without resumed param on normal launch', async () => {
    SessionService.hasActiveShift.mockResolvedValue(false);
    await presenter.checkSessionAndNavigate(navigation);
    expect(navigation.replace).not.toHaveBeenCalledWith('Dashboard', expect.anything());
  });
});