import { PatientRecord } from '../types/patient'

export interface IPatientRepository {
  get(id: string): Promise<PatientRecord | null>
  updateField(id: string, fieldKey: string, value: string | string[]): Promise<void>
  deleteRecord(id: string): Promise<void>
}
