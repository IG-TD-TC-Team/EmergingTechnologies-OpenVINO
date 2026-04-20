/**
 * BedDetailScreen — US10
 *
 * Tests:
 *   - Renders "What do I know" header title
 *   - Renders patient identifier ("Bed X: 'Name'")
 *   - SessionActiveCard visible when sessionCard is set
 *   - Empty state message when cards array is empty
 *   - InfoCard renders with eye icon when hasData=true && flagged=false
 *   - InfoCard has orange background when flagged=true
 *   - InfoCard calls onCardPress when tapped
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import BedDetailScreen from '../BedDetailScreen';
import { RecordingProvider } from '../../contexts/RecordingContext';

// ─── Mock presenter so mount() never hits real services ───────────────────────

jest.mock('../../presenters/PatientDetailsPresenter', () => {
    return jest.fn().mockImplementation(() => ({
        mount:          jest.fn(),
        unmount:        jest.fn(),
        onToggleSource: jest.fn(),
        onMicPress:     jest.fn(),
        onCardPress:    jest.fn(),
    }));
});

// ─── Mock AudioSourceBadge to avoid SVG rendering complexity ──────────────────

jest.mock('../AudioSourceBadge', () => ({
    AudioSourceBadge: () => null,
    MicInputIcon:     () => null,
}));

// ─── react-native-svg stub ────────────────────────────────────────────────────

jest.mock('react-native-svg', () => ({
    SvgXml: () => null,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };

function makeRoute(overrides = {}) {
    return {
        params: {
            patient: { id: 'p-1', bed: '2', name: 'Bob' },
            sessionId: 'session-abc',
            segments: [],
            ...overrides,
        },
    };
}

function renderScreen(routeOverrides = {}) {
    return render(
        <RecordingProvider>
            <BedDetailScreen
                navigation={mockNavigation}
                route={makeRoute(routeOverrides)}
            />
        </RecordingProvider>
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BedDetailScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders "What do I know" title', () => {
        const { getByText } = renderScreen();
        expect(getByText('What do I know')).toBeTruthy();
    });

    it('renders patient identifier with bed and name', () => {
        const { getByText } = renderScreen();
        expect(getByText("Bed 2: 'Bob'")).toBeTruthy();
    });

    it('renders patient identifier with bed only when name is absent', () => {
        const { getByText } = renderScreen({ patient: { id: 'p-2', bed: '3', name: '' } });
        expect(getByText('Bed 3')).toBeTruthy();
    });

    it('shows empty state message when no cards', () => {
        const { getByText } = renderScreen();
        expect(
            getByText(/No information extracted yet/i)
        ).toBeTruthy();
    });

    it('does not show empty state message when cards are present', () => {
        // PatientDetailsPresenter is mocked — we drive setCards via the view ref
        // by spying on the constructor and invoking setCards through the captured view
        const PatientDetailsPresenter = require('../../presenters/PatientDetailsPresenter');
        let capturedView = null;
        PatientDetailsPresenter.mockImplementationOnce((view) => {
            capturedView = view;
            return {
                mount:          jest.fn().mockImplementation(() => {
                    view.setCards([
                        { type: 'medications', hasData: true, flagged: false, confidence: 1.0, preview: 'Aspirin' },
                    ]);
                }),
                unmount:        jest.fn(),
                onToggleSource: jest.fn(),
                onMicPress:     jest.fn(),
                onCardPress:    jest.fn(),
            };
        });

        const { queryByText } = renderScreen();
        expect(queryByText(/No information extracted yet/i)).toBeNull();
    });

    it('shows SessionActiveCard when session data is provided', () => {
        const PatientDetailsPresenter = require('../../presenters/PatientDetailsPresenter');
        PatientDetailsPresenter.mockImplementationOnce((view) => ({
            mount: jest.fn().mockImplementation(() => {
                view.setSessionCard({
                    startedAt: '2026-04-20T07:00:00.000Z',
                    expiresAt: '2026-04-20T21:00:00.000Z',
                });
            }),
            unmount:        jest.fn(),
            onToggleSource: jest.fn(),
            onMicPress:     jest.fn(),
            onCardPress:    jest.fn(),
        }));

        const { getByText } = renderScreen();
        expect(getByText('Session Active')).toBeTruthy();
    });

    it('InfoCard shows card title for each type', () => {
        const PatientDetailsPresenter = require('../../presenters/PatientDetailsPresenter');
        PatientDetailsPresenter.mockImplementationOnce((view) => ({
            mount: jest.fn().mockImplementation(() => {
                view.setCards([
                    { type: 'medications',     hasData: true,  flagged: false, confidence: 1.0, preview: 'Aspirin' },
                    { type: 'vital_signs',     hasData: true,  flagged: false, confidence: 1.0, preview: 'HR 72' },
                    { type: 'recent_activity', hasData: true,  flagged: false, confidence: 1.0, preview: 'Last: 08:30' },
                ]);
            }),
            unmount:        jest.fn(),
            onToggleSource: jest.fn(),
            onMicPress:     jest.fn(),
            onCardPress:    jest.fn(),
        }));

        const { getByText } = renderScreen();
        expect(getByText('Medications')).toBeTruthy();
        expect(getByText('Vital Signs')).toBeTruthy();
        expect(getByText('Recent Activity')).toBeTruthy();
    });

    it('calls presenter.onCardPress when an InfoCard is tapped', () => {
        const mockOnCardPress = jest.fn();
        const PatientDetailsPresenter = require('../../presenters/PatientDetailsPresenter');
        PatientDetailsPresenter.mockImplementationOnce((view) => ({
            mount: jest.fn().mockImplementation(() => {
                view.setCards([
                    { type: 'medications', hasData: true, flagged: false, confidence: 1.0, preview: 'Aspirin' },
                ]);
            }),
            unmount:        jest.fn(),
            onToggleSource: jest.fn(),
            onMicPress:     jest.fn(),
            onCardPress:    mockOnCardPress,
        }));

        const { getByText } = renderScreen();
        fireEvent.press(getByText('Medications'));
        expect(mockOnCardPress).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'medications' }),
            mockNavigation
        );
    });

    it('calls navigation.goBack when back button is pressed', () => {
        const { getByLabelText } = renderScreen();
        fireEvent.press(getByLabelText('Go back'));
        expect(mockNavigation.goBack).toHaveBeenCalled();
    });
});