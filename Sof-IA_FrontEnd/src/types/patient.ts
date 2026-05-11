export interface PatientField {
  key: string
  label: string
  value: string | string[]
  original_value?: string | string[]
  edited_by?: 'nurse'
  edited_at?: string
}

export interface PatientRecord {
  id: string
  bed_number: number
  name: string
  fields: PatientField[]
}

export interface EditPatientParams {
  patientId: string
  fieldKey: string
  currentValue: string | string[]
}
