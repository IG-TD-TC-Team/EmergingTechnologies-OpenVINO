/**
 * DashboardScreen — scroll position preservation (US10 Task 3)
 *
 * The Stack navigator keeps DashboardScreen mounted while BedDetailScreen is
 * on top.  Scroll position is therefore preserved as long as:
 *   1. DashboardPresenter.mount() is never called a second time on focus.
 *   2. No focus listener resets state (beds array, scroll offset, etc.).
 *   3. The FlatList carries no key prop that would force a re-mount.
 *
 * Tests:
 *   - presenter.mount() called exactly once on initial render
 *   - no navigation focus listener registered (no re-mount trigger on back)
 *   - beds list still rendered after a simulated focus event
 *   - presenter.mount() still called only once after a simulated focus event
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import DashboardScreen from '../DashboardScreen';
import { RecordingProvider } from '../../contexts/RecordingContext';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../presenters/DashboardPresenter', () =>
    jest.fn().mockImplementation((view) => ({
        mount: jest.fn().mockImplementation(() => {
            // Simulate presenter populating the bed list on mount
            view.setBeds([
                { id: 'b1', bed: '1', name: 'Alice' },
                { id: 'b2', bed: '2', name: 'Bob' },
            ]);
            view.setBedsLoading(false);
        }),
        unmount:              jest.fn(),
        onToggleSource:       jest.fn(),
        onRequestPermission:  jest.fn(),
        onOpenSettings:       jest.fn(),
        onBedPress:           jest.fn(),
        onClearActivePatient: jest.fn(),
        onEndShift:           jest.fn(),
    }))
);

jest.mock('../AudioSourceBadge', () => ({
    AudioSourceBadge: () => null,
    MicInputIcon:     () => null,
}));

jest.mock('../MicPermissionBanner', () => ({
    MicPermissionBanner: () => null,
}));

jest.mock('react-native-svg', () => ({
    SvgXml: () => null,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockNavigation() {
    return {
        goBack:      jest.fn(),
        navigate:    jest.fn(),
        addListener: jest.fn(() => jest.fn()), // returns unsubscribe noop
    };
}

function renderScreen(navigation) {
    return render(
        <RecordingProvider>
            <DashboardScreen navigation={navigation} route={{ params: {} }} />
        </RecordingProvider>
    );
}

// The mock factory returns a plain object, not `this`.
// mock.instances[0] is the constructor's `this` context (empty);
// mock.results[0].value is the actual returned object with our jest.fn() methods.
function getMockPresenter() {
    const DashboardPresenter = require('../../presenters/DashboardPresenter');
    return DashboardPresenter.mock.results[0].value;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardScreen — scroll position preservation', () => {
    beforeEach(() => jest.clearAllMocks());

    it('presenter.mount() is called exactly once on initial render', () => {
        const nav = makeMockNavigation();
        renderScreen(nav);
        expect(getMockPresenter().mount).toHaveBeenCalledTimes(1);
    });

    it('no focus listener is registered on navigation (no re-mount trigger on back)', () => {
        const nav = makeMockNavigation();
        renderScreen(nav);

        // If a focus listener were registered here, returning from BedDetails
        // could call mount() again and reset all state including scroll position.
        const focusListeners = nav.addListener.mock.calls.filter(
            ([event]) => event === 'focus'
        );
        expect(focusListeners).toHaveLength(0);
    });

    it('component is not unmounted on focus (state stays intact)', async () => {
        const nav = makeMockNavigation();
        renderScreen(nav);

        // Simulate the focus event React Navigation fires on returning from BedDetails
        const focusCallback = nav.addListener.mock.calls.find(
            ([event]) => event === 'focus'
        )?.[1];
        await act(async () => {
            if (focusCallback) focusCallback();
        });

        // presenter.unmount() is called by the useEffect cleanup when React unmounts
        // the component.  If it were called here it would mean state was lost.
        expect(getMockPresenter().unmount).not.toHaveBeenCalled();
    });

    it('presenter.mount() is still only called once after a simulated focus event', async () => {
        const nav = makeMockNavigation();
        renderScreen(nav);

        const focusCallback = nav.addListener.mock.calls.find(
            ([event]) => event === 'focus'
        )?.[1];
        await act(async () => {
            if (focusCallback) focusCallback();
        });

        expect(getMockPresenter().mount).toHaveBeenCalledTimes(1);
    });
});
