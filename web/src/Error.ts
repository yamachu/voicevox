export class InvalidRequestFieldError extends Error {
  field: string;
  constructor(field: string, message?: string) {
    super(message ?? `Missing required query parameter: ${field}`);
    this.name = "BadRequest";
    this.field = field;
  }
}

export class InvalidRequestFieldTypeError extends Error {
  field: string;
  expectedType: string;
  constructor(field: string, expectedType: string, message?: string) {
    super(
      message ??
        `Invalid type for query parameter: ${field}. Expected type: ${expectedType}`
    );
    this.name = "BadRequest";
    this.field = field;
    this.expectedType = expectedType;
  }
}
