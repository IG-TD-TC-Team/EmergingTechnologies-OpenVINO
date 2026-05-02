/**
 * CardDetailScreen — US11
 *
 * Tests:
 *   - Renders activityType as header title
 *   - Falls back to "Clinical Activity" when activityType is null
 *   - Renders patient identifier "Bed X: 'Name'"
 *   - Metadata bar shows timeLabel and language from presenter
 *   - Narrative: renders section headers and bodies when sections present
 *   - Narrative: renders raw transcript when no sections
 *   - Narrative: shows "No narrative available." when both null
 *   - Copy icon is present and calls presenter.onCopyPress when pressed
 *   - Edit icon is present and calls presenter.onEditPress when pressed
 *   - Back button calls navigation.goBack
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CardDetailScreen from '../CardDetailScreen';

// ─── Mock presenter ───────────────────────────────────────────────────────────

jest.mock('../../presenters/CardDetailPresenter', () => {
    return jest.fn().mockImplementation(() => ({
        mount:          jest.fn(),
        unmount:        jest.fn(),
        onToggleSource: jest.fn(),
        onEditPress:    jest.fn(),
        onCopyPress:    jest.fn(),
    }));
});

// ─── Mock AudioSourceBadge ────────────────────────────────────────────────────

jest.mock('../AudioSourceBadge', () => ({
    AudioSourceBadge: () => null,
}));

// ─── Mock react-native-svg ────────────────────────────────────────────────────

jest.mock('react-native-svg', () => ({
    SvgXml: () => null,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };

function makeRoute({ card = {}, patient = {} } = {}) {
    return {
        params: {
            patient: { id: 'p-1', bed: '1', name: 'Alice', ...patient },
            card: {
                type:         'recent_activity',
                hasData:      true,
                flagged:      false,
                activityType: 'Pain assessment',
                transcript:   'Patient reports pain.',
                language:     'fr',
                ts_start:     null,
                sections:     null,
                ...card,
            },
        },
    };
}

function renderScreen(routeOverrides = {}) {
    return render(
        <CardDetailScreen
            navigation={mockNavigation}
            route={makeRoute(routeOverrides)}
        />
    );
}

// ─── Helper to drive view methods via the captured presenter instance ─────────

function withPresenterDriving(viewCallback) {
    const CardDetailPresenter = require('../../presenters/CardDetailPresenter');
    CardDetailPresenter.mockImplementationOnce((view) => {
        viewCallback(view);
        return {
            mount:          jest.fn().mockImplementation(() => viewCallback(view)),
            unmount:        jest.fn(),
            onToggleSource: jest.fn(),
            onEditPress:    jest.fn(),
            onCopyPress:    jest.fn(),
        };
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CardDetailScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    // ── Header ──────────────────────────────────────────────────────────────────

    it('renders activityType as the header title', () => {
        const { getByText } = renderScreen({ card: { activityType: 'Pain assessment' } });
        expect(getByText('Pain assessment')).toBeTruthy();
    });

    it('falls back to "Clinical Activity" when activityType is null', () => {
        const { getByText } = renderScreen({ card: { activityType: null } });
        expect(getByText('Clinical Activity')).toBeTruthy();
    });

    // ── Patient identifier ───────────────────────────────────────────────────────

    it('renders patient identifier with bed and name', () => {
        const { getByText } = renderScreen({ patient: { id: 'p-1', bed: '2', name: 'Bob' } });
        expect(getByText("Bed 2: 'Bob'")).toBeTruthy();
    });

    it('renders bed only when patient name is absent', () => {
        const { getByText } = renderScreen({ patient: { id: 'p-1', bed: '3', name: '' } });
        expect(getByText('Bed 3')).toBeTruthy();
    });

    // ── Metadata bar ─────────────────────────────────────────────────────────────

    it('shows timeLabel from presenter setMetadata', () => {
        withPresenterDriving((view) => {
            view.setMetadata({ timeLabel: 'Today 14:10', language: 'fr' });
        });
        const { getByText } = renderScreen();
        expect(getByText('Today 14:10')).toBeTruthy();
    });

    it('shows language from presenter setMetadata', () => {
        withPresenterDriving((view) => {
            view.setMetadata({ timeLabel: 'Today –', language: 'en' });
        });
        const { getByText } = renderScreen();
        expect(getByText('Language: en')).toBeTruthy();
    });

    // ── Narrative content ────────────────────────────────────────────────────────

    it('renders section headers and bodies when sections are present', () => {
        withPresenterDriving((view) => {
            view.setNarrative({
                sections: [
                    { header: 'Assessment', body: 'Patient stable.' },
                    { header: 'Plan',       body: 'Monitor BP.' },
                ],
                transcript: null,
            });
        });
        const { getByText } = renderScreen();
        expect(getByText('Assessment')).toBeTruthy();
        expect(getByText('Patient stable.')).toBeTruthy();
        expect(getByText('Plan')).toBeTruthy();
        expect(getByText('Monitor BP.')).toBeTruthy();
    });

    it('renders raw transcript when sections is null', () => {
        withPresenterDriving((view) => {
            view.setNarrative({
                sections:   null,
                transcript: 'Plain transcript text.',
            });
        });
        const { getByText } = renderScreen();
        expect(getByText('Plain transcript text.')).toBeTruthy();
    });

    it('shows "No narrative available." when both sections and transcript are null', () => {
        withPresenterDriving((view) => {
            view.setNarrative({ sections: null, transcript: null });
        });
        const { getByText } = renderScreen();
        expect(getByText('No narrative available.')).toBeTruthy();
    });

    // ── Actions ──────────────────────────────────────────────────────────────────

    it('copy icon is present and calls presenter.onCopyPress when pressed', () => {
        const mockOnCopyPress = jest.fn();
        const CardDetailPresenter = require('../../presenters/CardDetailPresenter');
        CardDetailPresenter.mockImplementationOnce(() => ({
            mount:          jest.fn(),
            unmount:        jest.fn(),
            onToggleSource: jest.fn(),
            onEditPress:    jest.fn(),
            onCopyPress:    mockOnCopyPress,
        }));
        const { getByLabelText } = renderScreen();
        fireEvent.press(getByLabelText('Copy to clipboard'));
        expect(mockOnCopyPress).toHaveBeenCalled();
    });

    it('edit icon is present and calls presenter.onEditPress when pressed', () => {
        const mockOnEditPress = jest.fn();
        const CardDetailPresenter = require('../../presenters/CardDetailPresenter');
        CardDetailPresenter.mockImplementationOnce(() => ({
            mount:          jest.fn(),
            unmount:        jest.fn(),
            onToggleSource: jest.fn(),
            onEditPress:    mockOnEditPress,
            onCopyPress:    jest.fn(),
        }));
        const { getByLabelText } = renderScreen();
        fireEvent.press(getByLabelText('Edit'));
        expect(mockOnEditPress).toHaveBeenCalled();
    });

    it('calls navigation.goBack when back button is pressed', () => {
        const { getByLabelText } = renderScreen();
        fireEvent.press(getByLabelText('Go back'));
        expect(mockNavigation.goBack).toHaveBeenCalled();
    });

    // ── Copy toast ───────────────────────────────────────────────────────────────

    it('shows copy toast when presenter calls showCopyToast', () => {
        withPresenterDriving((view) => {
            view.showCopyToast();
        });
        const { getByText } = renderScreen();
        expect(getByText('Copied to clipboard')).toBeTruthy();
    });
});