import { getRepository } from './adapters/RepositoryFactory';

// Maps US19 PatientField keys to the corresponding Patient model columns.
// Keys absent from this map are synthetic (e.g. recent_activity) — their
// edited values are stored inside field_edits rather than a dedicated column.
const FIELD_COLUMN_MAP = {
  name:          'name',
  bed:           'bed',
  mrn:           'mrn',
  date_of_birth: 'date_of_birth',
  diagnosis:     'diagnosis',
  allergies:     'allergies',
  medications:   'medications',
  notes:         'notes',
};

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

function parseFieldEdits(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

// SqliteAdapter deserializes snake_case keys to camelCase; DexieAdapter keeps
// snake_case. This helper reads a field by snake_case key from either adapter.
function col(patient, snakeKey) {
  if (patient[snakeKey] !== undefined) return patient[snakeKey];
  const camelKey = snakeKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
  return patient[camelKey];
}

export class PatientRepository {
  async get(id) {
    const repo = await getRepository();
    const patient = await repo.read('patients', id);
    if (!patient) return null;

    const fieldEdits = parseFieldEdits(col(patient, 'field_edits'));
    const fields = [];

    // Standard patient-record fields
    for (const [key, column] of Object.entries(FIELD_COLUMN_MAP)) {
      const editMeta = fieldEdits[key];
      fields.push({
        key,
        label: FIELD_LABELS[key] || key,
        value: col(patient, column) ?? '',
        ...(editMeta
          ? {
              original_value: editMeta.original_value,
              edited_by:      editMeta.edited_by,
              edited_at:      editMeta.edited_at,
            }
          : {}),
      });
    }

    // Synthetic fields stored only in field_edits (e.g. recent_activity)
    for (const [key, meta] of Object.entries(fieldEdits)) {
      if (!FIELD_COLUMN_MAP[key]) {
        fields.push({
          key,
          label:          FIELD_LABELS[key] || key,
          value:          meta.value ?? '',
          original_value: meta.original_value,
          edited_by:      meta.edited_by,
          edited_at:      meta.edited_at,
        });
      }
    }

    return {
      id:         patient.id,
      bed_number: parseInt(patient.bed ?? '0') || 0,
      name:       patient.name,
      fields,
    };
  }

  async updateField(id, fieldKey, newValue) {
    const repo = await getRepository();
    const patient = await repo.read('patients', id);
    if (!patient) throw new Error(`Patient ${id} not found`);

    const fieldEdits = parseFieldEdits(col(patient, 'field_edits'));
    const now = new Date().toISOString();
    const directColumn = FIELD_COLUMN_MAP[fieldKey];

    // Preserve original (AI-captured) value on the first edit only
    let originalValue = fieldEdits[fieldKey]?.original_value;
    if (originalValue === undefined) {
      originalValue = directColumn ? (col(patient, directColumn) ?? null) : null;
    }

    const updateData = { last_interaction_at: now };

    if (directColumn) {
      updateData[directColumn] = Array.isArray(newValue)
        ? newValue.join(', ')
        : newValue;
      fieldEdits[fieldKey] = {
        original_value: originalValue,
        edited_by:      'nurse',
        edited_at:      now,
      };
    } else {
      // Synthetic field — keep value inside field_edits
      fieldEdits[fieldKey] = {
        value:          newValue,
        original_value: originalValue,
        edited_by:      'nurse',
        edited_at:      now,
      };
    }

    updateData.field_edits = JSON.stringify(fieldEdits);
    await repo.update('patients', id, updateData);
  }

  async deleteRecord(id) {
    const repo = await getRepository();
    await repo.delete('patients', id);
  }
}
