/**
 * EditPatientPresenter — US19
 *
 * Tests:
 *   mount — sets field label, current value from params; checks edit status from repo
 *   mount — marks field as edited when repo returns a field with edited_by
 *   mount — sets original value when field has original_value
 *   mount — setIsEdited(false) when repo.get returns null (patient not found)
 *   mount — setIsEdited(false) when repo.get throws
 *   onSave — calls repo.updateField then navigation.goBack
 *   onSave — calls view.showError and clears isSaving when repo throws
 *   onSave — no-ops when patientId is missing
 *   onCancel — calls navigation.goBack
 *   onDeletePress — calls view.showDeleteConfirm
 *   onDeleteConfirm — calls repo.deleteRecord then navigation.navigate('Dashboard')
 *   onDeleteConfirm — calls view.showError and clears isSaving when repo throws
 *   onDeleteConfirm — no-ops when patientId is missing
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGet          = jest.fn();
const mockUpdateField  = jest.fn();
const mockDeleteRecord = jest.fn();

jest.mock('../../repositories/PatientRepository', () => ({
    PatientRepository: jest.fn().mockImplementation(() => ({
        get:          mockGet,
        updateField:  mockUpdateField,
        deleteRecord: mockDeleteRecord,
    })),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import EditPatientPresenter from '../../presenters/EditPatientPresenter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeView() {
    return {
        setFieldLabel:     jest.fn(),
        setCurrentValue:   jest.fn(),
        setIsEdited:       jest.fn(),
        setOriginalValue:  jest.fn(),
        setIsSaving:       jest.fn(),
        showError:         jest.fn(),
        showDeleteConfirm: jest.fn(),
    };
}

function makeNavigation(overrides = {}) {
    return {
        goBack:   jest.fn(),
        navigate: jest.fn(),
        ...overrides,
    };
}

function makeParams(overrides = {}) {
    return {
        patientId:    'p-1',
        fieldKey:     'recent_activity',
        currentValue: 'Patient reports pain.',
        navigation:   makeNavigation(),
        ...overrides,
    };
}

function makePatientRecord(fieldOverrides = {}) {
    return {
        id:         'p-1',
        bed_number: 1,
        name:       'Alice',
        fields: [
            {
                key:   'recent_activity',
                label: 'Recent Activity',
                value: 'Patient reports pain.',
                ...fieldOverrides,
            },
        ],
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(null);
    mockUpdateField.mockResolvedValue(undefined);
    mockDeleteRecord.mockResolvedValue(undefined);
});

// ─── mount ────────────────────────────────────────────────────────────────────

describe('mount', () => {
    it('sets field label from FIELD_LABELS map', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ fieldKey: 'recent_activity' }));
        expect(view.setFieldLabel).toHaveBeenCalledWith('Recent Activity');
    });

    it('sets field label to raw fieldKey when not in map', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ fieldKey: 'custom_field' }));
        expect(view.setFieldLabel).toHaveBeenCalledWith('custom_field');
    });

    it('sets current value from params', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ currentValue: 'Some transcript text.' }));
        expect(view.setCurrentValue).toHaveBeenCalledWith('Some transcript text.');
    });

    it('coerces non-string currentValue to string', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ currentValue: 42 }));
        expect(view.setCurrentValue).toHaveBeenCalledWith('42');
    });

    it('sets empty string when currentValue is null', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ currentValue: null }));
        expect(view.setCurrentValue).toHaveBeenCalledWith('');
    });

    it('setIsEdited(false) when repo.get returns null', async () => {
        mockGet.mockResolvedValue(null);
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        expect(view.setIsEdited).toHaveBeenCalledWith(false);
    });

    it('setIsEdited(false) when repo.get throws', async () => {
        mockGet.mockRejectedValue(new Error('DB error'));
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        expect(view.setIsEdited).toHaveBeenCalledWith(false);
    });

    it('setIsEdited(true) when field.edited_by is nurse', async () => {
        mockGet.mockResolvedValue(
            makePatientRecord({ edited_by: 'nurse', edited_at: '2026-05-04T10:00:00Z' })
        );
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        expect(view.setIsEdited).toHaveBeenCalledWith(true);
    });

    it('setIsEdited(false) when field has no edited_by', async () => {
        mockGet.mockResolvedValue(makePatientRecord());
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        expect(view.setIsEdited).toHaveBeenCalledWith(false);
    });

    it('sets original value when field has original_value', async () => {
        mockGet.mockResolvedValue(
            makePatientRecord({
                edited_by:      'nurse',
                original_value: 'Original AI text.',
            })
        );
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        expect(view.setOriginalValue).toHaveBeenCalledWith('Original AI text.');
    });

    it('does not call setOriginalValue when original_value is absent', async () => {
        mockGet.mockResolvedValue(makePatientRecord({ edited_by: 'nurse' }));
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        expect(view.setOriginalValue).not.toHaveBeenCalled();
    });
});

// ─── onSave ───────────────────────────────────────────────────────────────────

describe('onSave', () => {
    it('calls repo.updateField with patientId, fieldKey, and new value', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        await p.onSave('Updated transcript.');
        expect(mockUpdateField).toHaveBeenCalledWith(
            'p-1', 'recent_activity', 'Updated transcript.'
        );
    });

    it('calls navigation.goBack after successful save', async () => {
        const navigation = makeNavigation();
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ navigation }));
        await p.onSave('Updated.');
        expect(navigation.goBack).toHaveBeenCalled();
    });

    it('calls setIsSaving(true) before save', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        await p.onSave('Updated.');
        expect(view.setIsSaving).toHaveBeenCalledWith(true);
    });

    it('calls view.showError and resets isSaving when repo throws', async () => {
        mockUpdateField.mockRejectedValue(new Error('write error'));
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        await p.onSave('x');
        expect(view.showError).toHaveBeenCalledWith(expect.stringContaining('Failed'));
        expect(view.setIsSaving).toHaveBeenCalledWith(false);
    });

    it('no-ops when patientId is not set', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.onSave('x');
        expect(mockUpdateField).not.toHaveBeenCalled();
    });
});

// ─── onCancel ─────────────────────────────────────────────────────────────────

describe('onCancel', () => {
    it('calls navigation.goBack', async () => {
        const navigation = makeNavigation();
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ navigation }));
        p.onCancel();
        expect(navigation.goBack).toHaveBeenCalled();
    });

    it('does not throw when navigation is absent', () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        expect(() => p.onCancel()).not.toThrow();
    });
});

// ─── onDeletePress ────────────────────────────────────────────────────────────

describe('onDeletePress', () => {
    it('calls view.showDeleteConfirm', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        p.onDeletePress();
        expect(view.showDeleteConfirm).toHaveBeenCalled();
    });
});

// ─── onDeleteConfirm ──────────────────────────────────────────────────────────

describe('onDeleteConfirm', () => {
    it('calls repo.deleteRecord with patientId', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        await p.onDeleteConfirm();
        expect(mockDeleteRecord).toHaveBeenCalledWith('p-1');
    });

    it('navigates to Dashboard after successful deletion', async () => {
        const navigation = makeNavigation();
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams({ navigation }));
        await p.onDeleteConfirm();
        expect(navigation.navigate).toHaveBeenCalledWith('Dashboard');
    });

    it('calls setIsSaving(true) before deletion', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        await p.onDeleteConfirm();
        expect(view.setIsSaving).toHaveBeenCalledWith(true);
    });

    it('calls view.showError and resets isSaving when repo throws', async () => {
        mockDeleteRecord.mockRejectedValue(new Error('delete error'));
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.mount(makeParams());
        await p.onDeleteConfirm();
        expect(view.showError).toHaveBeenCalledWith(expect.stringContaining('Failed'));
        expect(view.setIsSaving).toHaveBeenCalledWith(false);
    });

    it('no-ops when patientId is not set', async () => {
        const view = makeView();
        const p = new EditPatientPresenter(view);
        await p.onDeleteConfirm();
        expect(mockDeleteRecord).not.toHaveBeenCalled();
    });
});
