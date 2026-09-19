export const PROTOCOL_NAME = 'viewer-scoring-bridge';
export const PROTOCOL_VERSION = 1;

export type BridgeSender = 'host' | 'viewer';

export type SupportedTool = 'EllipticalROI';

export const MESSAGE_TYPE = {
  VIEWER_READY: 'VIEWER_READY',
  ACTIVATE_TOOL: 'ACTIVATE_TOOL',
  DEACTIVATE_TOOL: 'DEACTIVATE_TOOL',
  MEASUREMENT_ADDED: 'MEASUREMENT_ADDED',
  MEASUREMENT_UPDATED: 'MEASUREMENT_UPDATED',
  ACTIVATION_FAILED: 'ACTIVATION_FAILED',
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export type BridgeMeasurementValue = {
  kind: 'area';
  value: number;
  unit: string;
};

export type BridgeEnvelope<TType extends MessageType, TPayload> = {
  protocol: typeof PROTOCOL_NAME;
  version: typeof PROTOCOL_VERSION;
  sender: BridgeSender;
  type: TType;
  messageId: string;
  sentAt: number;
  payload: TPayload;
};

export type ViewerReadyPayload = {
  viewerInstanceId: string;
};

export type ActivateToolPayload = {
  rowId: string;
  activationId: string;
  toolName: SupportedTool;
};

export type DeactivateToolPayload = {
  rowId: string;
  activationId: string;
};

export type MeasurementAddedPayload = {
  rowId: string;
  activationId: string;
  measurementId: string;
  toolName: SupportedTool;
  measurement: BridgeMeasurementValue;
};

export type MeasurementUpdatedPayload = {
  rowId: string;
  measurementId: string;
  measurement: BridgeMeasurementValue;
};

export type ActivationFailedPayload = {
  rowId: string;
  activationId: string;
  reason: string;
};

export type ViewerReadyMessage = BridgeEnvelope<'VIEWER_READY', ViewerReadyPayload>;
export type ActivateToolMessage = BridgeEnvelope<'ACTIVATE_TOOL', ActivateToolPayload>;
export type DeactivateToolMessage = BridgeEnvelope<'DEACTIVATE_TOOL', DeactivateToolPayload>;
export type MeasurementAddedMessage = BridgeEnvelope<'MEASUREMENT_ADDED', MeasurementAddedPayload>;
export type MeasurementUpdatedMessage = BridgeEnvelope<
  'MEASUREMENT_UPDATED',
  MeasurementUpdatedPayload
>;
export type ActivationFailedMessage = BridgeEnvelope<'ACTIVATION_FAILED', ActivationFailedPayload>;

export type BridgeMessage =
  | ViewerReadyMessage
  | ActivateToolMessage
  | DeactivateToolMessage
  | MeasurementAddedMessage
  | MeasurementUpdatedMessage
  | ActivationFailedMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const isBridgeMeasurementValue = (value: unknown): value is BridgeMeasurementValue =>
  isRecord(value) &&
  value.kind === 'area' &&
  isFiniteNumber(value.value) &&
  isNonEmptyString(value.unit);

const isEnvelopeShape = (value: unknown): value is Record<string, unknown> & {
  payload: unknown;
} =>
  isRecord(value) &&
  value.protocol === PROTOCOL_NAME &&
  value.version === PROTOCOL_VERSION &&
  (value.sender === 'host' || value.sender === 'viewer') &&
  typeof value.type === 'string' &&
  isNonEmptyString(value.messageId) &&
  isFiniteNumber(value.sentAt) &&
  isRecord(value.payload);

export const isBridgeMessage = (value: unknown): value is BridgeMessage => {
  if (!isEnvelopeShape(value)) {
    return false;
  }

  const { payload } = value;

  switch (value.type) {
    case MESSAGE_TYPE.VIEWER_READY:
      return isNonEmptyString((payload as Record<string, unknown>).viewerInstanceId);

    case MESSAGE_TYPE.ACTIVATE_TOOL:
      return (
        isNonEmptyString((payload as Record<string, unknown>).rowId) &&
        isNonEmptyString((payload as Record<string, unknown>).activationId) &&
        (payload as Record<string, unknown>).toolName === 'EllipticalROI'
      );

    case MESSAGE_TYPE.DEACTIVATE_TOOL:
      return (
        isNonEmptyString((payload as Record<string, unknown>).rowId) &&
        isNonEmptyString((payload as Record<string, unknown>).activationId)
      );

    case MESSAGE_TYPE.MEASUREMENT_ADDED:
      return (
        isNonEmptyString((payload as Record<string, unknown>).rowId) &&
        isNonEmptyString((payload as Record<string, unknown>).activationId) &&
        isNonEmptyString((payload as Record<string, unknown>).measurementId) &&
        (payload as Record<string, unknown>).toolName === 'EllipticalROI' &&
        isBridgeMeasurementValue((payload as Record<string, unknown>).measurement)
      );

    case MESSAGE_TYPE.MEASUREMENT_UPDATED:
      return (
        isNonEmptyString((payload as Record<string, unknown>).rowId) &&
        isNonEmptyString((payload as Record<string, unknown>).measurementId) &&
        isBridgeMeasurementValue((payload as Record<string, unknown>).measurement)
      );

    case MESSAGE_TYPE.ACTIVATION_FAILED:
      return (
        isNonEmptyString((payload as Record<string, unknown>).rowId) &&
        isNonEmptyString((payload as Record<string, unknown>).activationId) &&
        isNonEmptyString((payload as Record<string, unknown>).reason)
      );

    default:
      return false;
  }
};

export const isBridgeMessageFromSender = (
  value: unknown,
  expectedSender: BridgeSender
): value is BridgeMessage => isBridgeMessage(value) && value.sender === expectedSender;