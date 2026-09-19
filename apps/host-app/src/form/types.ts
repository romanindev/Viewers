export type RowStatus = 'waiting' | 'drawing' | 'processing' | 'ready';

export type FormRow = {
  id: string;
  status: RowStatus;
  activationId: string | null;
  measurementId: string | null;
  value: number | null;
  unit: string | null;
  failureReason: string | null;
};