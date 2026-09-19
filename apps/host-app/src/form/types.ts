export type RowStatus = 'waiting' | 'drawing';

export type FormRow = {
  id: string;
  status: RowStatus;
  activationId: string | null;
  failureReason: string | null;
};