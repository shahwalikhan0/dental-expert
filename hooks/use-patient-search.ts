'use client'

/**
 * Finding a patient, on the server.
 *
 * Three forms picked a patient by fetching `/api/patients?limit=100` once and
 * filtering that array in the browser. Both halves of that are wrong at the
 * size a real register reaches:
 *
 *   - the register is not a hundred records. Patient 101 onwards was not in
 *     the array, so searching for them showed "No patients found" — which is
 *     worse than an empty list, because it is a confident wrong answer about
 *     somebody who is sitting in the waiting room;
 *   - matching happened one column at a time, so "John Smith" matched nothing:
 *     neither the forename nor the surname contains both words. The route
 *     knows how to read a full name.
 *
 * The four forms that already searched the server each wrote their own copy of
 * the debounce, the stale-response guard and the render states. This is that,
 * once — and since the drug catalogue and the stock list needed the same, the
 * machinery now lives in `useCatalogueSearch`; this is that hook pointed at
 * `/api/patients`. For a whole picker (field, rows, chosen-patient card) use
 * `PatientPicker` from components/patients/patient-picker.tsx.
 *
 * An empty box still shows a list rather than nothing, because these forms
 * open onto the picker and an empty panel reads as broken. With no term it
 * asks for the first page — newest first, which is usually who the clinic is
 * dealing with today.
 */
import {
  useCatalogueSearch,
  PICKER_LIMIT,
  type CatalogueSearch,
} from '@/hooks/use-catalogue-search'

export { MIN_TERM } from '@/hooks/use-catalogue-search'

/**
 * What the hook answers with. The fields every caller already read are kept;
 * `total`, `isPreload` and `retry` are new and optional to use.
 */
export type PatientSearch<T> = CatalogueSearch<T>

export function usePatientSearch<T>(limit = PICKER_LIMIT): PatientSearch<T> {
  return useCatalogueSearch<T>({ endpoint: '/api/patients', limit })
}
