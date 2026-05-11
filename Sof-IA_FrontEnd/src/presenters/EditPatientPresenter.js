import { PatientRepository } from '../repositories/PatientRepository';

const FIELD_LABELS = {
  name:            'Patient Name',
  bed:             'Bed / Room',
  mrn:             'Medical Record Number',
  date_of_birth:   'Date of Birth',
  diagnosis:       'Diagnosis',
  allergies:       'Allergies',
  medications:     'Medications',
  notes:           'Notes',
  recent_activity: 'Recent Activity',
  vital_signs:     'Vital Signs',
  next_reminder:   'Next Reminder',
  safety_info:     'Safety Information',
};

export default class EditPatientPresenter {
  constructor(view) {
    this._view       = view;
    this._patientId  = null;
    this._fieldKey   = null;
    this._navigation = null;
    this._repo       = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async mount({ patientId, fieldKey, currentValue, navigation }) {
    this._patientId  = patientId;
    this._fieldKey   = fieldKey;
    this._navigation = navigation;
    this._repo       = new PatientRepository();

    const label = FIELD_LABELS[fieldKey] || fieldKey;
    this._view.setFieldLabel(label);
    this._view.setCurrentValue(currentValue != null ? String(currentValue) : '');

    try {
      const record = await this._repo.get(patientId);
      const field  = record?.fields?.find((f) => f.key === fieldKey);
      this._view.setIsEdited(!!field?.edited_by);
      if (field?.original_value != null) {
        this._view.setOriginalValue(String(field.original_value));
      }
    } catch (_) {
      this._view.setIsEdited(false);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async onSave(newValue) {
    if (!this._patientId || !this._fieldKey) return;
    this._view.setIsSaving(true);
    try {
      await this._repo.updateField(this._patientId, this._fieldKey, newValue);
      this._navigation?.goBack();
    } catch (_) {
      this._view.setIsSaving(false);
      this._view.showError('Failed to save changes. Please try again.');
    }
  }

  onCancel() {
    this._navigation?.goBack();
  }

  onDeletePress() {
    this._view.showDeleteConfirm();
  }

  async onDeleteConfirm() {
    if (!this._patientId) return;
    this._view.setIsSaving(true);
    try {
      await this._repo.deleteRecord(this._patientId);
      this._navigation?.navigate('Dashboard');
    } catch (_) {
      this._view.setIsSaving(false);
      this._view.showError('Failed to delete record. Please try again.');
    }
  }
}
